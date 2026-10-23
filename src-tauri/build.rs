fn main() {
    // Listing the commands generates an `allow-<command>` permission for each, so every
    // capability must grant the commands it needs. That keeps the remote ZTM pages in
    // the web views limited to `web_view_fullscreen` (see capabilities/academy.json).
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "load_courses",
            "sync_courses",
            "load_state",
            "save_state",
            "show_web_view",
            "set_web_view_bounds",
            "hide_web_view",
            "dispose_web_view",
            "open_course_window",
            "sign_out",
            "web_view_fullscreen",
            "set_web_view_theme",
        ]),
    ))
    .expect("failed to run tauri-build");
}
