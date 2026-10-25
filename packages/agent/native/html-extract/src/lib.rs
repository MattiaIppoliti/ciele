//! `htmlToText` as a WebAssembly module with a hand-written ABI: the host
//! allocates `len` bytes with `alloc`, writes UTF-8 HTML there, calls
//! `html_to_text(ptr, len)`, reads the JSON answer from `result_ptr()` /
//! `result_len()`, then frees both.

mod html;
mod page;

use std::cell::RefCell;

thread_local! {
    static RESULT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(len);
    let ptr = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    ptr
}

/// # Safety
/// `ptr` and `len` must come from one `alloc` call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    drop(unsafe { Vec::from_raw_parts(ptr, 0, len) });
}

/// # Safety
/// `ptr..ptr+len` must be UTF-8 written by the host into an `alloc` block.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn html_to_text(ptr: *const u8, len: usize) {
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
    let html = std::str::from_utf8(bytes).unwrap_or("");
    let (title, text) = html::html_to_text(html);
    let json = serde_json::json!({ "title": title, "text": text }).to_string();
    RESULT.with(|cell| *cell.borrow_mut() = json.into_bytes());
}

#[unsafe(no_mangle)]
pub extern "C" fn result_ptr() -> *const u8 {
    RESULT.with(|cell| cell.borrow().as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn result_len() -> usize {
    RESULT.with(|cell| cell.borrow().len())
}

/// # Safety
/// `html` and `url` ranges must be UTF-8 written by the host into `alloc`
/// blocks.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn extract_page(
    html: *const u8,
    html_len: usize,
    url: *const u8,
    url_len: usize,
) {
    let html =
        std::str::from_utf8(unsafe { std::slice::from_raw_parts(html, html_len) }).unwrap_or("");
    let url =
        std::str::from_utf8(unsafe { std::slice::from_raw_parts(url, url_len) }).unwrap_or("");
    let json = page::extract_page(html, url).to_string();
    RESULT.with(|cell| *cell.borrow_mut() = json.into_bytes());
}
