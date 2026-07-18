import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { ResizableLayout } from "@/components/layout/resizable-layout";

export const metadata: Metadata = {
  title: "Mission Control",
  description: "Daedalus operational dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}
      >
        <ResizableLayout>{children}</ResizableLayout>
      </body>
    </html>
  );
}
