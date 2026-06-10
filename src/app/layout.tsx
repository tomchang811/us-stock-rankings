import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "美股成交值排行 Top 50",
  description: "即時美股成交值（成交金額）排行榜，可點擊欄位切換排序。",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-TW">
      <body className="min-h-screen overflow-x-hidden antialiased">{children}</body>
    </html>
  );
}
