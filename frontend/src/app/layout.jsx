import "./globals.css";
import { Toaster } from "../components/ui";

export const metadata = {
  title: "BuildVendo: launch your online store",
  description: "Multi-tenant e-commerce platform with an AI store builder.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
