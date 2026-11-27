import QRCode from "qrcode";

/** Public base URL for links printed on reports: APP_URL, else the request's own origin. */
export function appBaseUrl(request: Request) {
  const configured = process.env.APP_URL?.trim();
  return (configured || new URL(request.url).origin).replace(/\/+$/, "");
}

/** `${APP_URL}/verify/${verifyCode}` - what the QR code on a result PDF encodes. */
export function verifyUrl(verifyCode: string, request: Request) {
  return `${appBaseUrl(request)}/verify/${encodeURIComponent(verifyCode)}`;
}

/** QR code as a PNG (dark modules on white, quiet zone of 2 modules) for embedding in a PDF. */
export async function qrPng(text: string): Promise<Uint8Array> {
  const buffer = await QRCode.toBuffer(text, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 2,
    width: 360,
    color: { dark: "#111827ff", light: "#ffffffff" },
  });
  return new Uint8Array(buffer);
}
