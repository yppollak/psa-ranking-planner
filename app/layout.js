import "./globals.css";
export const metadata = { title: "Tour Advisor", description: "Which tournaments to enter — points, defending, divisor and travel, for professional squash players.", icons: { icon: "/icon.svg" } };
export default function RootLayout({ children }){
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
