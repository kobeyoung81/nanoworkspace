// A docx is rendered into a detached container first and then serialized into a
// sandboxed frame: the library's stylesheet must not reach the portal document,
// and the result must not be able to run script.
//
// `fonts` carries the *rules* for the fonts the document asks for; the wrapper
// puts them in a <style> element. Keep that wrapping here: a bare run of CSS
// dropped into <head> is not stylesheet text to the HTML parser, it is character
// data, and the parser moves it into <body> where it is rendered as a wall of
// text above the document.
//
// The frame is an opaque origin, so those font files are fetched cross-origin
// and nginx has to allow it — without them the document falls back to Times and
// every line break moves.
export function docxDocumentHtml(styles: string, body: string, fonts = ''): string {
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    // The frame is already sandboxed without `allow-scripts`; the meta is a
    // second fence for anything the document itself brings along.
    `<meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'">`,
    '<style>html,body{margin:0;padding:0;background:#f3f4f6}</style>',
    fonts ? `<style>${fonts}</style>` : '',
    styles,
    '</head><body>',
    body,
    '</body></html>',
  ].join('')
}
