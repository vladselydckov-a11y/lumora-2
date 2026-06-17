import './globals.css';

export const metadata = {
  title: 'Lumora',
  description: 'AI-analytics for restaurant owners'
};

export default function RootLayout({ children }) {
  return (
    <html lang="ru">
      <head>
        <script src="https://telegram.org/js/telegram-web-app.js" async />
      </head>
      <body>{children}</body>
    </html>
  );
}
