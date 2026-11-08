//! Top-level window list, one static preview frame, activate, and close.
//!
//! `list_windows` does not capture pixels. Previews use Windows.Graphics.Capture
//! for a single frame. PrintWindow / BitBlt is not used: GPU windows such as
//! Chrome often come back black. DWM live thumbnails are not used.
//! One card is one top-level window. Tab strips are not scraped.
//! Exclusive fullscreen games cannot be covered. Aura does not inject into them.
//!
//! The preview cache is filled by a background pass that starts with the process.
//! A later `capture_window` for the same hwnd and title returns that JPEG.
//! Only a new hwnd, a title change, or a new foreground window grabs another frame.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Condvar, LazyLock, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use image::ImageEncoder;
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, TRUE, WPARAM};
use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_HARDWARE, D3D_DRIVER_TYPE_WARP};
use windows::Win32::Graphics::Direct3D11::{
    D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_READ,
    D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING, D3D11CreateDevice, ID3D11Device,
    ID3D11DeviceContext, ID3D11Resource, ID3D11Texture2D,
};
use windows::Win32::Graphics::Dwm::{DWMWA_CLOAKED, DwmGetWindowAttribute};
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_FORMAT_B8G8R8A8_UNORM_SRGB, DXGI_SAMPLE_DESC,
};
use windows::Win32::Graphics::Dxgi::IDXGIAdapter;
use windows::Win32::System::Threading::{
    AttachThreadInput, GetCurrentThreadId, OpenProcess, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
use windows::Win32::System::WinRT::Direct3D11::{
    CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess,
};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
use windows::Win32::System::WinRT::{RO_INIT_MULTITHREADED, RoInitialize};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GWL_EXSTYLE, GetClassNameW, GetForegroundWindow, GetWindowLongPtrW, GetWindowTextLengthW,
    GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible, PostMessageW,
    SW_RESTORE, SetForegroundWindow, ShowWindow, WINDOW_EX_STYLE, WM_CLOSE, WS_EX_APPWINDOW,
    WS_EX_TOOLWINDOW,
};
use windows::Graphics::Capture::{
    Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession,
};
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Graphics::SizeInt32;
use windows::core::{Error, Interface, PWSTR};
use windows::Win32::Graphics::Dxgi::IDXGIDevice;
use windows::Win32::Foundation::HMODULE;

const PREVIEW_CACHE_LIMIT: usize = 40;
const CAPTURE_SLOTS: usize = 2;
const PREVIEW_LONG_EDGE: u32 = 480;
const PREVIEW_TIMEOUT: Duration = Duration::from_millis(900);
const MAX_PREVIEW_PIXELS: usize = 16_000_000;
const SHELL_CLASSES: &[&str] = &["Progman", "Shell_TrayWnd"];

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListedWindow {
    pub hwnd: String,
    pub process_name: String,
    pub title: String,
}

#[derive(Clone, serde::Serialize)]
pub struct WindowPreview {
    pub image: Option<String>,
    pub error: Option<String>,
    /// Increases when a preview is invalidated. Older replies must not replace a newer frame.
    pub revision: u64,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowList {
    pub windows: Vec<ListedWindow>,
    pub foreground_hwnd: Option<String>,
}

#[derive(Clone, serde::Serialize)]
pub struct PreviewUpdate {
    pub hwnd: String,
    pub image: Option<String>,
    pub error: Option<String>,
    pub revision: u64,
}

struct CollectedWindow {
    order: usize,
    process_name: String,
    sort_key: String,
    title: String,
    hwnd: HWND,
}

struct CachedPreview {
    hwnd: String,
    title: String,
    image: Option<String>,
    error: Option<String>,
    revision: u64,
}

struct Gpu {
    device: ID3D11Device,
    context: ID3D11DeviceContext,
}

struct PreviewCache {
    entries: VecDeque<CachedPreview>,
}

static PREVIEW_CACHE: Mutex<PreviewCache> = Mutex::new(PreviewCache {
    entries: VecDeque::new(),
});
static PREVIEW_GENERATION: LazyLock<Mutex<HashMap<String, u64>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
static OWN_HWND: Mutex<Option<isize>> = Mutex::new(None);
static GPU: Mutex<Option<Gpu>> = Mutex::new(None);
static CONTEXT: Mutex<()> = Mutex::new(());
static CAPTURE_GATE: Mutex<usize> = Mutex::new(0);
static CAPTURE_GATE_CV: Condvar = Condvar::new();

pub fn parse_hwnd(value: &str) -> Result<HWND, String> {
    let bits: u64 = value
        .parse()
        .map_err(|_| "Invalid window handle".to_string())?;
    let pointer = usize::try_from(bits)
        .map_err(|_| "Invalid window handle".to_string())? as *mut core::ffi::c_void;
    if pointer.is_null() {
        return Err("Invalid window handle".to_string());
    }
    Ok(HWND(pointer))
}

pub fn hwnd_to_string(hwnd: HWND) -> String {
    (hwnd.0 as usize).to_string()
}

pub fn list_windows(own: HWND) -> Result<Vec<ListedWindow>, String> {
    let mut hwnds = Vec::new();
    unsafe {
        EnumWindows(Some(push_hwnd), LPARAM(&mut hwnds as *mut Vec<HWND> as isize)).map_err(win_err)?;
    }

    let mut kept = Vec::new();
    for (order, hwnd) in hwnds.into_iter().enumerate() {
        if !keep_window(hwnd, own) {
            continue;
        }
        let title = window_title(hwnd);
        if title.is_empty() {
            continue;
        }
        let process_name = process_file_name(hwnd);
        kept.push(CollectedWindow {
            order,
            sort_key: process_name.to_lowercase(),
            process_name,
            title,
            hwnd,
        });
    }

    kept.sort_by(|left, right| {
        left.sort_key
            .cmp(&right.sort_key)
            .then(left.order.cmp(&right.order))
    });

    Ok(kept
        .into_iter()
        .map(|item| ListedWindow {
            hwnd: hwnd_to_string(item.hwnd),
            process_name: item.process_name,
            title: item.title,
        })
        .collect())
}

pub fn raise_window(hwnd: HWND) -> Result<(), String> {
    unsafe {
        if !IsWindow(Some(hwnd)).as_bool() {
            return Err("That window is no longer open.".to_string());
        }
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }
        if SetForegroundWindow(hwnd).as_bool() && GetForegroundWindow() == hwnd {
            return Ok(());
        }
        attach_and_foreground(hwnd)
    }
}

pub fn close_window(hwnd_text: &str) -> Result<(), String> {
    let hwnd = parse_hwnd(hwnd_text)?;
    unsafe {
        if !IsWindow(Some(hwnd)).as_bool() {
            return Err("That window is no longer open.".to_string());
        }
        // Aura stays unelevated. An elevated window can reject this post.
        PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0)).map_err(|error| {
            if access_denied(&error) {
                "That window did not accept close. It may be running elevated.".to_string()
            } else {
                let message = win_err(error);
                if message.is_empty() {
                    "Could not close that window.".to_string()
                } else {
                    message
                }
            }
        })
    }
}

pub fn set_own_hwnd(hwnd: HWND) {
    if hwnd.0.is_null() {
        return;
    }
    *lock_own() = Some(hwnd.0 as isize);
}

pub fn foreground_hwnd() -> Option<String> {
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.0.is_null() {
        None
    } else {
        Some(hwnd_to_string(hwnd))
    }
}

/// Hwnds that need a new capture between two listings.
///
/// A hwnd is dirty when it is new or its title changed. The foreground hwnd is
/// dirty only when it changed and it is still in `next`. Missing hwnds are not
/// captured. The same lists and the same foreground return an empty set.
pub fn dirty_windows(
    previous: &[ListedWindow],
    next: &[ListedWindow],
    foreground_hwnd: Option<&str>,
    previous_foreground: Option<&str>,
) -> Vec<String> {
    let mut prior: HashMap<&str, &str> = HashMap::new();
    for window in previous {
        prior.entry(window.hwnd.as_str()).or_insert(window.title.as_str());
    }

    let mut dirty = Vec::new();
    let mut seen = HashSet::new();
    for window in next {
        let changed = match prior.get(window.hwnd.as_str()) {
            None => true,
            Some(title) => *title != window.title.as_str(),
        };
        if changed && seen.insert(window.hwnd.clone()) {
            dirty.push(window.hwnd.clone());
        }
    }

    if foreground_hwnd != previous_foreground {
        if let Some(hwnd) = foreground_hwnd {
            if next.iter().any(|window| window.hwnd == hwnd) && seen.insert(hwnd.to_string()) {
                dirty.push(hwnd.to_string());
            }
        }
    }
    dirty
}

pub fn prune_generations(live: &[ListedWindow]) {
    let keep: HashSet<&str> = live.iter().map(|window| window.hwnd.as_str()).collect();
    lock_generations().retain(|hwnd, _| keep.contains(hwnd.as_str()));
}

/// Drop any cached frame and grab again. Used when a window becomes foreground
/// or its title changes, including after a sticky capture failure.
pub fn refresh_preview(hwnd_text: &str) -> PreviewUpdate {
    let hwnd_key = parse_hwnd(hwnd_text).ok().map(|hwnd| hwnd_to_string(hwnd));
    if let Some(key) = &hwnd_key {
        bump_generation(key);
        forget_preview(key);
    }
    let preview = capture_window(hwnd_text, false);
    PreviewUpdate {
        hwnd: hwnd_key.unwrap_or_else(|| hwnd_text.to_string()),
        image: preview.image,
        error: preview.error,
        revision: preview.revision,
    }
}

pub fn capture_window(hwnd_text: &str, cache_only: bool) -> WindowPreview {
    let hwnd = match parse_hwnd(hwnd_text) {
        Ok(hwnd) => hwnd,
        Err(error) => return preview_error(error),
    };
    if is_own_hwnd(hwnd) {
        return preview_error("Preview unavailable".to_string());
    }
    if unsafe { !IsWindow(Some(hwnd)).as_bool() } {
        return preview_error("That window is no longer open.".to_string());
    }

    let key = hwnd_to_string(hwnd);
    let title = window_title(hwnd);
    if let Some(hit) = cached_preview(&key, &title) {
        return hit;
    }
    if cache_only {
        return WindowPreview {
            image: None,
            error: None,
            revision: 0,
        };
    }

    let revision = generation(&key);
    let _slot = acquire_slot();
    if window_title(hwnd) == title {
        if let Some(hit) = cached_preview(&key, &title) {
            return hit;
        }
    }
    if generation(&key) != revision {
        let title_now = window_title(hwnd);
        if let Some(hit) = cached_preview(&key, &title_now) {
            return hit;
        }
        return WindowPreview {
            image: None,
            error: None,
            revision: generation(&key),
        };
    }

    match grab_jpeg(hwnd) {
        Ok(data_url) => {
            let title_now = window_title(hwnd);
            let current = generation(&key);
            if title_now == title && current == revision {
                remember_preview(key, title, Some(data_url.clone()), None, revision);
            }
            WindowPreview {
                image: Some(data_url),
                error: None,
                revision,
            }
        }
        Err(error) => {
            let title_now = window_title(hwnd);
            let current = generation(&key);
            if title_now == title && current == revision {
                remember_preview(key, title, None, Some(error.clone()), revision);
            }
            WindowPreview {
                image: None,
                error: Some(error),
                revision,
            }
        }
    }
}

unsafe extern "system" fn push_hwnd(hwnd: HWND, param: LPARAM) -> windows::core::BOOL {
    unsafe {
        let list = &mut *(param.0 as *mut Vec<HWND>);
        list.push(hwnd);
    }
    TRUE
}

fn keep_window(hwnd: HWND, own: HWND) -> bool {
    unsafe {
        if !own.is_invalid() && hwnd == own {
            return false;
        }
        if !IsWindowVisible(hwnd).as_bool() {
            return false;
        }
        let exstyle = WINDOW_EX_STYLE(GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32);
        if exstyle.contains(WS_EX_TOOLWINDOW) && !exstyle.contains(WS_EX_APPWINDOW) {
            return false;
        }
        // DWMWA_CLOAKED is 14. Cloaked UWP ghosts (ApplicationFrameWindow / CoreWindow) drop here.
        let mut cloaked = 0u32;
        if DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            &mut cloaked as *mut u32 as *mut core::ffi::c_void,
            std::mem::size_of::<u32>() as u32,
        )
        .is_ok()
            && cloaked != 0
        {
            return false;
        }
        let class = class_name(hwnd);
        if SHELL_CLASSES.iter().any(|name| *name == class) {
            return false;
        }
        true
    }
}

fn class_name(hwnd: HWND) -> String {
    unsafe {
        let mut buffer = [0u16; 256];
        let copied = GetClassNameW(hwnd, &mut buffer);
        if copied <= 0 {
            return String::new();
        }
        String::from_utf16_lossy(&buffer[..copied as usize])
    }
}

fn window_title(hwnd: HWND) -> String {
    unsafe {
        let mut length = GetWindowTextLengthW(hwnd);
        if length <= 0 {
            return String::new();
        }
        if length > 2048 {
            length = 2048;
        }
        let mut buffer = vec![0u16; length as usize + 1];
        let copied = GetWindowTextW(hwnd, &mut buffer);
        if copied <= 0 {
            return String::new();
        }
        String::from_utf16_lossy(&buffer[..copied as usize]).trim().to_string()
    }
}

fn process_file_name(hwnd: HWND) -> String {
    unsafe {
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return String::new();
        }
        let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            return String::new();
        };
        let mut buffer = vec![0u16; 32768];
        let mut size = buffer.len() as u32;
        let queried = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(buffer.as_mut_ptr()), &mut size);
        let _ = CloseHandle(process);
        if queried.is_err() || size == 0 {
            return String::new();
        }
        let path = String::from_utf16_lossy(&buffer[..size as usize]);
        path.rsplit(['\\', '/']).next().unwrap_or("").to_string()
    }
}

fn attach_and_foreground(hwnd: HWND) -> Result<(), String> {
    unsafe {
        let current = GetCurrentThreadId();
        let foreground = GetForegroundWindow();
        let foreground_thread = GetWindowThreadProcessId(foreground, None);
        let target_thread = GetWindowThreadProcessId(hwnd, None);
        let mut attached_foreground = false;
        let mut attached_target = false;
        if foreground_thread != 0 && foreground_thread != current {
            attached_foreground = AttachThreadInput(current, foreground_thread, true).as_bool();
        }
        if target_thread != 0 && target_thread != current && target_thread != foreground_thread {
            attached_target = AttachThreadInput(current, target_thread, true).as_bool();
        }

        let brought = SetForegroundWindow(hwnd).as_bool();
        let focused = GetForegroundWindow() == hwnd;

        if attached_target {
            let _ = AttachThreadInput(current, target_thread, false);
        }
        if attached_foreground {
            let _ = AttachThreadInput(current, foreground_thread, false);
        }

        if brought || focused {
            Ok(())
        } else {
            Err("Could not bring that window forward.".to_string())
        }
    }
}

fn cached_preview(hwnd: &str, title: &str) -> Option<WindowPreview> {
    let mut cache = lock_cache();
    let stale = cache
        .entries
        .iter()
        .any(|entry| entry.hwnd == hwnd && entry.title != title);
    if stale {
        cache.entries.retain(|entry| entry.hwnd != hwnd);
        return None;
    }
    cache
        .entries
        .iter()
        .find(|entry| entry.hwnd == hwnd && entry.title == title)
        .map(|entry| WindowPreview {
            image: entry.image.clone(),
            error: entry.error.clone(),
            revision: entry.revision,
        })
}

fn remember_preview(hwnd: String, title: String, image: Option<String>, error: Option<String>, revision: u64) {
    let mut cache = lock_cache();
    cache.entries.retain(|entry| entry.hwnd != hwnd);
    cache.entries.push_back(CachedPreview {
        hwnd,
        title,
        image,
        error,
        revision,
    });
    while cache.entries.len() > PREVIEW_CACHE_LIMIT {
        cache.entries.pop_front();
    }
}

fn forget_preview(hwnd: &str) {
    lock_cache().entries.retain(|entry| entry.hwnd != hwnd);
}

fn lock_cache() -> std::sync::MutexGuard<'static, PreviewCache> {
    PREVIEW_CACHE.lock().unwrap_or_else(|poison| poison.into_inner())
}

fn lock_generations() -> std::sync::MutexGuard<'static, HashMap<String, u64>> {
    PREVIEW_GENERATION
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
}

fn lock_own() -> std::sync::MutexGuard<'static, Option<isize>> {
    OWN_HWND.lock().unwrap_or_else(|poison| poison.into_inner())
}

fn generation(hwnd: &str) -> u64 {
    lock_generations().get(hwnd).copied().unwrap_or(0)
}

fn bump_generation(hwnd: &str) -> u64 {
    let mut generations = lock_generations();
    let entry = generations.entry(hwnd.to_string()).or_insert(0);
    *entry = entry.wrapping_add(1);
    *entry
}

fn is_own_hwnd(hwnd: HWND) -> bool {
    lock_own().is_some_and(|own| own == hwnd.0 as isize)
}

struct CaptureSlot;

impl Drop for CaptureSlot {
    fn drop(&mut self) {
        let mut inflight = CAPTURE_GATE.lock().unwrap_or_else(|poison| poison.into_inner());
        *inflight = inflight.saturating_sub(1);
        CAPTURE_GATE_CV.notify_one();
    }
}

fn acquire_slot() -> CaptureSlot {
    let mut inflight = CAPTURE_GATE.lock().unwrap_or_else(|poison| poison.into_inner());
    while *inflight >= CAPTURE_SLOTS {
        inflight = CAPTURE_GATE_CV
            .wait(inflight)
            .unwrap_or_else(|poison| poison.into_inner());
    }
    *inflight += 1;
    CaptureSlot
}

fn preview_error(error: String) -> WindowPreview {
    WindowPreview {
        image: None,
        error: Some(error),
        revision: 0,
    }
}

fn grab_jpeg(hwnd: HWND) -> Result<String, String> {
    let (device, context) = clone_gpu()?;
    let rgb = grab_frame(&device, &context, hwnd)?;
    encode_jpeg(rgb)
}

fn clone_gpu() -> Result<(ID3D11Device, ID3D11DeviceContext), String> {
    let mut gpu_slot = GPU.lock().unwrap_or_else(|poison| poison.into_inner());
    if gpu_slot
        .as_ref()
        .is_some_and(|gpu| unsafe { gpu.device.GetDeviceRemovedReason().is_err() })
    {
        *gpu_slot = None;
    }
    if gpu_slot.is_none() {
        *gpu_slot = Some(create_gpu()?);
    }
    let gpu = gpu_slot.as_ref().expect("graphics device");
    Ok((gpu.device.clone(), gpu.context.clone()))
}

fn create_gpu() -> Result<Gpu, String> {
    let (device, context) = create_device(D3D_DRIVER_TYPE_HARDWARE)
        .or_else(|_| create_device(D3D_DRIVER_TYPE_WARP))?;
    Ok(Gpu { device, context })
}

fn create_device(driver: windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE) -> Result<(ID3D11Device, ID3D11DeviceContext), String> {
    unsafe {
        let mut device = None;
        let mut context = None;
        D3D11CreateDevice(
            None::<&IDXGIAdapter>,
            driver,
            HMODULE(std::ptr::null_mut()),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut context),
        )
        .map_err(win_err)?;
        Ok((
            device.ok_or_else(|| "Could not create a graphics device.".to_string())?,
            context.ok_or_else(|| "Could not create a graphics context.".to_string())?,
        ))
    }
}

fn grab_frame(device: &ID3D11Device, context: &ID3D11DeviceContext, hwnd: HWND) -> Result<image::RgbImage, String> {
    unsafe {
        let _ = RoInitialize(RO_INIT_MULTITHREADED);
    }
    if !GraphicsCaptureSession::IsSupported().map_err(win_err)? {
        return Err("Window preview is not supported on this system.".to_string());
    }

    let interop: IGraphicsCaptureItemInterop =
        windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>().map_err(win_err)?;
    let item: GraphicsCaptureItem = unsafe { interop.CreateForWindow(hwnd).map_err(win_err)? };
    let size = item.Size().map_err(win_err)?;
    if size.Width <= 0 || size.Height <= 0 {
        return Err("That window has no visible area to preview.".to_string());
    }

    let direct = direct3d_device(device)?;
    let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
        &direct,
        DirectXPixelFormat::B8G8R8A8UIntNormalized,
        2,
        size,
    )
    .map_err(win_err)?;
    let session = pool.CreateCaptureSession(&item).map_err(win_err)?;
    // False so Windows does not draw the yellow capture border.
    session.SetIsBorderRequired(false).map_err(|_| {
        "Could not capture without the system border.".to_string()
    })?;
    let _ = session.SetIsCursorCaptureEnabled(false);
    session.StartCapture().map_err(win_err)?;

    let started = Instant::now();
    let frame = loop {
        match pool.TryGetNextFrame() {
            Ok(frame) => {
                let content = frame.ContentSize().unwrap_or(SizeInt32 { Width: 0, Height: 0 });
                if content.Width > 0 && content.Height > 0 {
                    break frame;
                }
                let _ = frame.Close();
            }
            Err(_) => {}
        }
        if started.elapsed() > PREVIEW_TIMEOUT {
            let _ = session.Close();
            let _ = pool.Close();
            return Err("Timed out waiting for a preview.".to_string());
        }
        thread::sleep(Duration::from_millis(15));
    };

    let read = {
        // The immediate context is not thread-safe. The frame wait above stays
        // outside this lock so two captures can be in flight.
        let _context = CONTEXT.lock().unwrap_or_else(|poison| poison.into_inner());
        read_frame(device, context, &frame)
    };
    let _ = frame.Close();
    let _ = session.Close();
    let _ = pool.Close();
    read
}

fn direct3d_device(device: &ID3D11Device) -> Result<IDirect3DDevice, String> {
    let dxgi: IDXGIDevice = device.cast().map_err(win_err)?;
    let inspectable = unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi).map_err(win_err)? };
    inspectable.cast().map_err(win_err)
}

fn read_frame(
    device: &ID3D11Device,
    context: &ID3D11DeviceContext,
    frame: &windows::Graphics::Capture::Direct3D11CaptureFrame,
) -> Result<image::RgbImage, String> {
    let surface = frame.Surface().map_err(win_err)?;
    let access: IDirect3DDxgiInterfaceAccess = surface.cast().map_err(win_err)?;
    let texture: ID3D11Texture2D = unsafe { access.GetInterface().map_err(win_err)? };
    let mut desc = D3D11_TEXTURE2D_DESC::default();
    unsafe { texture.GetDesc(&mut desc) };
    if desc.Width == 0 || desc.Height == 0 {
        return Err("Preview frame was empty.".to_string());
    }
    if desc.Format != DXGI_FORMAT_B8G8R8A8_UNORM && desc.Format != DXGI_FORMAT_B8G8R8A8_UNORM_SRGB {
        return Err("Preview frame was not a readable color format.".to_string());
    }
    if desc.SampleDesc.Count > 1 {
        return Err("Preview frame could not be read.".to_string());
    }
    let pixels = (desc.Width as usize)
        .checked_mul(desc.Height as usize)
        .ok_or_else(|| "Preview frame was too large.".to_string())?;
    if pixels > MAX_PREVIEW_PIXELS {
        return Err("Preview frame was too large.".to_string());
    }

    let staging_desc = D3D11_TEXTURE2D_DESC {
        Width: desc.Width,
        Height: desc.Height,
        MipLevels: 1,
        ArraySize: 1,
        Format: desc.Format,
        SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
        Usage: D3D11_USAGE_STAGING,
        BindFlags: 0,
        CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
        MiscFlags: 0,
    };
    let mut staging_slot: Option<ID3D11Texture2D> = None;
    unsafe {
        device
            .CreateTexture2D(&staging_desc, None, Some(&mut staging_slot))
            .map_err(win_err)?;
        let staging = staging_slot.ok_or_else(|| "Could not create a staging texture.".to_string())?;
        let source: ID3D11Resource = texture.cast().map_err(win_err)?;
        let dest: ID3D11Resource = staging.cast().map_err(win_err)?;
        context.CopyResource(&dest, &source);
        context.Flush();
        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        context
            .Map(&dest, 0, D3D11_MAP_READ, 0, Some(&mut mapped))
            .map_err(win_err)?;
        let rgb = copy_bgra(&mapped, desc.Width, desc.Height);
        context.Unmap(&dest, 0);
        rgb
    }
}

fn copy_bgra(mapped: &D3D11_MAPPED_SUBRESOURCE, width: u32, height: u32) -> Result<image::RgbImage, String> {
    if mapped.pData.is_null() {
        return Err("Preview frame was empty.".to_string());
    }
    let row_bytes = (width as usize)
        .checked_mul(4)
        .ok_or_else(|| "Preview frame was too large.".to_string())?;
    if (mapped.RowPitch as usize) < row_bytes {
        return Err("Preview frame could not be read.".to_string());
    }
    let mut rgb = Vec::with_capacity((width as usize) * (height as usize) * 3);
    unsafe {
        let source = mapped.pData as *const u8;
        for y in 0..height as usize {
            let row = source.add(y * mapped.RowPitch as usize);
            for x in 0..width as usize {
                let pixel = row.add(x * 4);
                rgb.push(*pixel.add(2));
                rgb.push(*pixel.add(1));
                rgb.push(*pixel);
            }
        }
    }
    image::RgbImage::from_raw(width, height, rgb).ok_or_else(|| "Preview frame could not be read.".to_string())
}

fn encode_jpeg(image: image::RgbImage) -> Result<String, String> {
    let scaled = fit_long_edge(image::DynamicImage::ImageRgb8(image), PREVIEW_LONG_EDGE);
    let width = scaled.width();
    let height = scaled.height();
    let rgb = scaled.into_rgb8();
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 80)
        .write_image(rgb.as_raw(), width, height, image::ExtendedColorType::Rgb8)
        .map_err(|error| error.to_string())?;
    Ok(format!("data:image/jpeg;base64,{}", base64_encode(&jpeg)))
}

fn fit_long_edge(image: image::DynamicImage, max_edge: u32) -> image::DynamicImage {
    let long = image.width().max(image.height());
    if long <= max_edge || long == 0 {
        return image;
    }
    image.resize(max_edge, max_edge, image::imageops::FilterType::Triangle)
}

fn base64_encode(data: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let first = chunk[0] as u32;
        let second = chunk.get(1).copied().unwrap_or(0) as u32;
        let third = chunk.get(2).copied().unwrap_or(0) as u32;
        let triple = (first << 16) | (second << 8) | third;
        out.push(TABLE[((triple >> 18) & 0x3f) as usize] as char);
        out.push(TABLE[((triple >> 12) & 0x3f) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((triple >> 6) & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(triple & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

fn win_err(error: Error) -> String {
    let message = error.message();
    if message.trim().is_empty() {
        format!("Windows error {:#010x}", error.code().0 as u32)
    } else {
        message
    }
}

fn access_denied(error: &Error) -> bool {
    let code = error.code().0 as u32;
    code == 5 || code == 0x8007_0005
}

#[cfg(test)]
mod tests {
    use super::{ListedWindow, dirty_windows};

    fn windows(items: &[(&str, &str)]) -> Vec<ListedWindow> {
        items
            .iter()
            .map(|(hwnd, title)| ListedWindow {
                hwnd: (*hwnd).to_string(),
                process_name: String::new(),
                title: (*title).to_string(),
            })
            .collect()
    }

    fn same(actual: &[String], expected: &[&str]) -> bool {
        if actual.len() != expected.len() {
            return false;
        }
        let mut left: Vec<&str> = actual.iter().map(String::as_str).collect();
        let mut right: Vec<&str> = expected.to_vec();
        left.sort_unstable();
        right.sort_unstable();
        left == right
    }

    #[test]
    fn title_change_marks_only_that_hwnd() {
        let previous = windows(&[("1", "Alpha"), ("2", "Beta"), ("3", "Gamma")]);
        let next = windows(&[("1", "Alpha"), ("2", "Beta+"), ("3", "Gamma")]);
        let dirty = dirty_windows(&previous, &next, Some("1"), Some("1"));
        assert!(same(&dirty, &["2"]), "{dirty:?}");
    }

    #[test]
    fn new_hwnd_is_dirty_and_a_missing_hwnd_is_not_captured() {
        let previous = windows(&[("1", "Alpha"), ("2", "Beta")]);
        let next = windows(&[("1", "Alpha"), ("3", "Gamma")]);
        let dirty = dirty_windows(&previous, &next, Some("1"), Some("1"));
        assert!(same(&dirty, &["3"]), "{dirty:?}");
        assert!(!dirty.iter().any(|hwnd| hwnd == "2"));
    }

    #[test]
    fn foreground_change_marks_only_a_listed_hwnd() {
        let list = windows(&[("1", "Alpha"), ("2", "Beta"), ("3", "Gamma")]);
        let dirty = dirty_windows(&list, &list, Some("3"), Some("1"));
        assert!(same(&dirty, &["3"]), "{dirty:?}");
        assert!(dirty_windows(&list, &list, Some("9"), Some("1")).is_empty());
    }

    #[test]
    fn unchanged_inactive_windows_are_not_dirty() {
        let previous = windows(&[("1", "Alpha"), ("2", "Beta"), ("3", "Gamma")]);
        let next = windows(&[("1", "Alpha"), ("2", "Beta+"), ("3", "Gamma")]);
        let dirty = dirty_windows(&previous, &next, Some("1"), Some("1"));
        assert!(!dirty.iter().any(|hwnd| hwnd == "1" || hwnd == "3"));
    }

    #[test]
    fn the_same_lists_and_foreground_are_empty() {
        let list = windows(&[("1", "Alpha"), ("2", "Beta"), ("3", "Gamma")]);
        let first = dirty_windows(&list, &list, Some("3"), Some("1"));
        assert!(same(&first, &["3"]));
        let second = dirty_windows(&list, &list, Some("3"), Some("3"));
        assert!(second.is_empty(), "{second:?}");
    }
}
