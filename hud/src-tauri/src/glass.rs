//! Inset rounded sheet for the Aura glass.
//!
//! The blur region is in physical pixels. `glass_sheet` is the inset math and
//! does not touch a window. Margin and radius are 32 and 28 CSS pixels times
//! the window scale factor. Keep those CSS sizes in step with `hud/src/App.css`.

use windows::Win32::Foundation::{FALSE, HWND, TRUE};
use windows::Win32::Graphics::Dwm::{
    DWMWA_SYSTEMBACKDROP_TYPE, DWM_BB_BLURREGION, DWM_BB_ENABLE, DWMSBT_NONE, DWM_BLURBEHIND,
    DwmEnableBlurBehindWindow, DwmSetWindowAttribute,
};
use windows::Win32::Graphics::Gdi::{CreateRoundRectRgn, DeleteObject};

/// CSS pixels. The stylesheet uses the same inset.
const GLASS_MARGIN_CSS: f64 = 32.0;
/// CSS pixels. The stylesheet uses the same corner radius.
const GLASS_RADIUS_CSS: f64 = 28.0;

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

#[cfg(test)]
mod glass_sheet_tests {
    use super::glass_sheet;

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
}
