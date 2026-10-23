mod academy;
mod app_state;
mod web_view;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(web_view::FullscreenWindows::default())
        .manage(web_view::PromotionState::default())
        .manage(web_view::WebViewTheme::default());
    #[cfg(target_os = "linux")]
    let builder = builder.manage(web_view::PendingCourseSession::default());
    builder
        .on_window_event(web_view::handle_window_event)
        .invoke_handler(tauri::generate_handler![
            academy::load_courses,
            academy::sync_courses,
            app_state::load_state,
            app_state::save_state,
            web_view::show_web_view,
            web_view::set_web_view_bounds,
            web_view::hide_web_view,
            web_view::dispose_web_view,
            web_view::open_course_window,
            web_view::sign_out,
            web_view::web_view_fullscreen,
            web_view::set_web_view_theme
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
