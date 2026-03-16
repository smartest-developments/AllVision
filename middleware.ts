import { NextResponse, type NextRequest } from 'next/server';
import { DEFAULT_LOCALE, isSupportedLocale } from './src/i18n/locales';

export function middleware(request: NextRequest) {
  const url = new URL(request.url);
  const params = url.searchParams;

  // Handle explicit ?lang=xx switch: set cookie and redirect without the query param.
  const langParam = params.get('lang');
  if (langParam && isSupportedLocale(langParam)) {
    params.delete('lang');
    url.search = params.toString();
    const response = NextResponse.redirect(url);
    response.cookies.set('locale', langParam, { path: '/', sameSite: 'lax' });
    return response;
  }

  // Ensure a locale cookie exists for downstream rendering.
  const cookieLocale = request.cookies.get('locale')?.value;
  if (!cookieLocale || !isSupportedLocale(cookieLocale)) {
    const response = NextResponse.next();
    response.cookies.set('locale', DEFAULT_LOCALE, { path: '/', sameSite: 'lax' });
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/|favicon.ico|robots.txt|sitemap.xml|api/health|api/ready).*)',
  ],
};
