//! Inset rounded sheet for the Aura glass.
//!
//! The blur region is in physical pixels. `glass_sheet` is the inset math and
//! does not touch a window. Margin and radius are 32 and 28 CSS pixels times
//! the window scale factor. Keep those CSS sizes in step with `hud/src/App.css`.

use image::ImageEncoder;

use windows::Win32::Foundation::{FALSE, HWND, TRUE};
use windows::Win32::Graphics::Dwm::{
    DWMWA_SYSTEMBACKDROP_TYPE, DWM_BB_BLURREGION, DWM_BB_ENABLE, DWMSBT_NONE, DWM_BLURBEHIND,
    DwmEnableBlurBehindWindow, DwmSetWindowAttribute,
};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleBitmap, CreateCompatibleDC, CreateRoundRectRgn, DeleteDC, DeleteObject, GetDC,
    GetDIBits, ReleaseDC, SelectObject, SetStretchBltMode, StretchBlt, BITMAPINFO, BITMAPINFOHEADER,
    DIB_RGB_COLORS, HALFTONE, HGDIOBJ, SRCCOPY,
};

/// CSS pixels. The stylesheet uses the same inset.
const GLASS_MARGIN_CSS: f64 = 32.0;
/// CSS pixels. The stylesheet uses the same corner radius.
const GLASS_RADIUS_CSS: f64 = 28.0;

/// How far the desktop grab is shrunk before it is blurred.
/// `DwmEnableBlurBehindWindow` has no radius, and on Windows 11 that blur stays
/// light enough to read. This shrink is what makes words unreadable while large
/// shapes and colours remain. Raise it for a heavier blur.
const BACKDROP_DOWNSCALE: u32 = 8;
/// Extra blur on the shrunk image, in that image's own pixels.
const BACKDROP_BLUR_SIGMA: f32 = 10.0;
/// Longest edge of the JPEG painted into the sheet. The blur is already done.
const BACKDROP_LONG_EDGE: u32 = 1400;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GlassSheet {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub radius: i32,
}

/// Rounded rectangle inset from every side of a monitor by exactly `margin`.
/// `radius` is clamped so it cannot exceed half the shorter sheet side.
/// Width and height are the remaining span; they stay positive when `margin`
/// is smaller than half of each monitor side.
pub fn glass_sheet(monitor_width: i32, monitor_height: i32, margin: i32, radius: i32) -> GlassSheet {
    let width = monitor_width - margin * 2;
    let height = monitor_height - margin * 2;
    let shorter = width.min(height);
    let cap = if shorter > 0 { shorter / 2 } else { 0 };
    GlassSheet {
        x: margin,
        y: margin,
        width,
        height,
        radius: radius.clamp(0, cap),
    }
}

fn css_to_physical(css_px: f64, scale: f64) -> i32 {
    let scale = if scale.is_finite() && scale > 0.0 { scale } else { 1.0 };
    (css_px * scale).round() as i32
}

/// Turns the system backdrop off, then clips blur to the rounded sheet.
/// A failed region is not replaced with a full-window blur.
pub fn apply_glass_blur(hwnd: HWND, width: u32, height: u32, scale: f64) {
    if hwnd.0.is_null() {
        return;
    }
    let Ok(width) = i32::try_from(width) else {
        return;
    };
    let Ok(height) = i32::try_from(height) else {
        return;
    };
    let sheet = glass_sheet(
        width,
        height,
        css_to_physical(GLASS_MARGIN_CSS, scale),
        css_to_physical(GLASS_RADIUS_CSS, scale),
    );

    unsafe {
        let backdrop = DWMSBT_NONE;
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_SYSTEMBACKDROP_TYPE,
            &backdrop as *const _ as *const core::ffi::c_void,
            std::mem::size_of_val(&backdrop) as u32,
        );

        if sheet.width <= 0 || sheet.height <= 0 {
            eprintln!("Aura glass sheet does not fit this monitor.");
            return;
        }

        let diameter = sheet.radius.saturating_mul(2);
        let region = CreateRoundRectRgn(
            sheet.x,
            sheet.y,
            sheet.x + sheet.width,
            sheet.y + sheet.height,
            diameter,
            diameter,
        );
        if region.is_invalid() {
            eprintln!("Aura could not build the rounded glass region.");
            return;
        }

        let blur = DWM_BLURBEHIND {
            dwFlags: DWM_BB_ENABLE | DWM_BB_BLURREGION,
            fEnable: TRUE,
            hRgnBlur: region,
            fTransitionOnMaximized: FALSE,
        };
        if let Err(error) = DwmEnableBlurBehindWindow(hwnd, &blur) {
            eprintln!("Aura could not clip the glass blur: {error}");
        }
        let _ = DeleteObject(region.into());
    }
}

/// Size of the desktop grab after `BACKDROP_DOWNSCALE`. Each side stays at least 1.
pub fn shrunk_extent(width: u32, height: u32, factor: u32) -> (u32, u32) {
    let factor = factor.max(1);
    ((width / factor).max(1), (height / factor).max(1))
}

/// Copy the desktop under the sheet, while Aura is still hidden, and blur it
/// hard enough that body text cannot be read. Returns a JPEG data URL.
/// The clear margin is not part of this image.
pub fn capture_backdrop(
    origin_x: i32,
    origin_y: i32,
    monitor_width: u32,
    monitor_height: u32,
    scale: f64,
) -> Option<String> {
    let Ok(width) = i32::try_from(monitor_width) else {
        return None;
    };
    let Ok(height) = i32::try_from(monitor_height) else {
        return None;
    };
    let sheet = glass_sheet(
        width,
        height,
        css_to_physical(GLASS_MARGIN_CSS, scale),
        css_to_physical(GLASS_RADIUS_CSS, scale),
    );
    if sheet.width <= 0 || sheet.height <= 0 {
        return None;
    }
    let (small_w, small_h) = shrunk_extent(sheet.width as u32, sheet.height as u32, BACKDROP_DOWNSCALE);
    let grabbed = unsafe {
        grab_screen(
            origin_x + sheet.x,
            origin_y + sheet.y,
            sheet.width,
            sheet.height,
            small_w,
            small_h,
        )
    }?;
    let blurred = image::imageops::fast_blur(&grabbed, BACKDROP_BLUR_SIGMA);
    let fitted = fit_long_edge(image::DynamicImage::ImageRgb8(blurred), BACKDROP_LONG_EDGE);
    let rgb = fitted.to_rgb8();
    let jpeg = encode_jpeg(&rgb)?;
    Some(format!("data:image/jpeg;base64,{jpeg}"))
}

unsafe fn grab_screen(
    source_x: i32,
    source_y: i32,
    source_w: i32,
    source_h: i32,
    dest_w: u32,
    dest_h: u32,
) -> Option<image::RgbImage> {
    let screen = unsafe { GetDC(None) };
    if screen.is_invalid() {
        return None;
    }
    let memory = unsafe { CreateCompatibleDC(Some(screen)) };
    if memory.is_invalid() {
        unsafe { ReleaseDC(None, screen) };
        return None;
    }
    let bitmap = unsafe { CreateCompatibleBitmap(screen, dest_w as i32, dest_h as i32) };
    if bitmap.is_invalid() {
        unsafe {
            let _ = DeleteDC(memory);
            ReleaseDC(None, screen);
        }
        return None;
    }
    let previous = unsafe { SelectObject(memory, bitmap.into()) };
    unsafe { SetStretchBltMode(memory, HALFTONE) };
    let copied = unsafe {
        StretchBlt(
            memory,
            0,
            0,
            dest_w as i32,
            dest_h as i32,
            Some(screen),
            source_x,
            source_y,
            source_w,
            source_h,
            SRCCOPY,
        )
    };
    let image = if copied.as_bool() {
        unsafe { read_dib(memory, bitmap, dest_w, dest_h) }
    } else {
        None
    };
    unsafe {
        if !previous.is_invalid() {
            SelectObject(memory, previous);
        }
        let _ = DeleteObject(HGDIOBJ(bitmap.0));
        let _ = DeleteDC(memory);
        ReleaseDC(None, screen);
    }
    image
}

unsafe fn read_dib(
    dc: windows::Win32::Graphics::Gdi::HDC,
    bitmap: windows::Win32::Graphics::Gdi::HBITMAP,
    width: u32,
    height: u32,
) -> Option<image::RgbImage> {
    let mut info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width as i32,
            biHeight: -(height as i32),
            biPlanes: 1,
            biBitCount: 32,
            biCompression: 0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut pixels = vec![0u8; (width * height * 4) as usize];
    let rows = unsafe {
        GetDIBits(
            dc,
            bitmap,
            0,
            height,
            Some(pixels.as_mut_ptr().cast()),
            &mut info,
            DIB_RGB_COLORS,
        )
    };
    if rows <= 0 {
        return None;
    }
    let mut rgb = image::RgbImage::new(width, height);
    for (index, pixel) in pixels.chunks_exact(4).enumerate() {
        let x = (index as u32) % width;
        let y = (index as u32) / width;
        if y >= height {
            break;
        }
        rgb.put_pixel(x, y, image::Rgb([pixel[2], pixel[1], pixel[0]]));
    }
    Some(rgb)
}

fn fit_long_edge(image: image::DynamicImage, max_edge: u32) -> image::DynamicImage {
    let width = image.width();
    let height = image.height();
    let long_edge = width.max(height);
    if long_edge <= max_edge || long_edge == 0 {
        return image;
    }
    image.resize(max_edge, max_edge, image::imageops::FilterType::Triangle)
}

fn encode_jpeg(image: &image::RgbImage) -> Option<String> {
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 75)
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            image::ExtendedColorType::Rgb8,
        )
        .ok()?;
    Some(base64_encode(&jpeg))
}

fn base64_encode(data: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((triple >> 18) & 63) as usize] as char);
        out.push(TABLE[((triple >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((triple >> 6) & 63) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(triple & 63) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

#[cfg(test)]
mod glass_sheet_tests {
    use super::{base64_encode, glass_sheet, shrunk_extent};

    const MARGIN: i32 = 32;
    const RADIUS: i32 = 28;

    fn assert_inset(monitor_width: i32, monitor_height: i32, margin: i32, radius: i32) {
        let sheet = glass_sheet(monitor_width, monitor_height, margin, radius);
        assert_eq!(sheet.x, margin, "{monitor_width}x{monitor_height} left inset");
        assert_eq!(sheet.y, margin, "{monitor_width}x{monitor_height} top inset");
        assert_eq!(
            monitor_width - (sheet.x + sheet.width),
            margin,
            "{monitor_width}x{monitor_height} right inset"
        );
        assert_eq!(
            monitor_height - (sheet.y + sheet.height),
            margin,
            "{monitor_width}x{monitor_height} bottom inset"
        );
        assert!(sheet.width > 0, "{monitor_width}x{monitor_height} width");
        assert!(sheet.height > 0, "{monitor_width}x{monitor_height} height");
        let shorter = sheet.width.min(sheet.height);
        assert!(
            sheet.radius <= shorter / 2,
            "{monitor_width}x{monitor_height} radius {} exceeds half of {shorter}",
            sheet.radius
        );
        let sheet_area = i64::from(sheet.width) * i64::from(sheet.height);
        let monitor_area = i64::from(monitor_width) * i64::from(monitor_height);
        assert!(
            sheet_area < monitor_area,
            "{monitor_width}x{monitor_height} margin is not real"
        );
    }

    #[test]
    fn inset_on_common_monitors() {
        for (width, height) in [(1920, 1080), (2560, 1440), (1366, 768), (3440, 1440)] {
            assert_inset(width, height, MARGIN, RADIUS);
            let sheet = glass_sheet(width, height, MARGIN, RADIUS);
            assert_eq!(sheet.radius, RADIUS);
        }
    }

    #[test]
    fn short_monitor_stays_positive() {
        let sheet = glass_sheet(1366, 768, MARGIN, RADIUS);
        assert_eq!(sheet.width, 1366 - MARGIN * 2);
        assert_eq!(sheet.height, 768 - MARGIN * 2);
        assert!(sheet.width > 0);
        assert!(sheet.height > 0);
    }

    #[test]
    fn radius_clamps_to_half_the_shorter_side() {
        let sheet = glass_sheet(1366, 768, MARGIN, 10_000);
        let shorter = sheet.width.min(sheet.height);
        assert_eq!(sheet.radius, shorter / 2);
        assert!(sheet.radius < 10_000);

        let tight = glass_sheet(100, 80, MARGIN, RADIUS);
        let tight_shorter = tight.width.min(tight.height);
        assert!(tight.width > 0 && tight.height > 0);
        assert_eq!(tight.radius, tight_shorter / 2);
        assert!(tight.radius < RADIUS);
    }

    #[test]
    fn shrink_keeps_a_pixel_and_divides() {
        assert_eq!(shrunk_extent(1920, 1080, 8), (240, 135));
        assert_eq!(shrunk_extent(7, 3, 8), (1, 1));
        assert_eq!(shrunk_extent(100, 50, 0), (100, 50));
    }

    #[test]
    fn base64_encodes_a_known_triple() {
        assert_eq!(base64_encode(b"Man"), "TWFu");
        assert_eq!(base64_encode(b"Ma"), "TWE=");
        assert_eq!(base64_encode(b"M"), "TQ==");
    }
}
