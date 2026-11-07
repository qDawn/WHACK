
import subprocess


def get_active_window():
    try:
        window_id = subprocess.check_output(
            ["xdotool", "getactivewindow"],
            text=True,
            stderr=subprocess.DEVNULL
        ).strip()

        title = subprocess.check_output(
            ["xdotool", "getwindowname", window_id],
            text=True,
            stderr=subprocess.DEVNULL
        ).strip()

        try:
            pid = subprocess.check_output(
                ["xdotool", "getwindowpid", window_id],
                text=True,
                stderr=subprocess.DEVNULL
            ).strip()
        except subprocess.CalledProcessError:
            pid = None

        process_name = None

        if pid:
            try:
                with open(f"/proc/{pid}/comm") as file:
                    process_name = file.read().strip()
            except (FileNotFoundError, PermissionError):
                pass

        return {
            "window_id": window_id,
            "window_title": title,
            "process_id": int(pid) if pid else None,
            "process_name": process_name
        }

    except (subprocess.CalledProcessError, FileNotFoundError):
        return None
