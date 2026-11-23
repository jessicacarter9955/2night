import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'

// Protegge interfaccia, asset dei giochi e API prima della distribuzione.
// In produzione non apriamo mai il sito se la configurazione manca.
function equals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  return left.length === right.length && timingSafeEqual(left, right)
}

export function proxy(request: NextRequest) {
  const user = process.env.INSPECT_BASIC_USER
  const password = process.env.INSPECT_BASIC_PASSWORD

  if (!user || !password) {
    if (process.env.NODE_ENV !== 'production') return NextResponse.next()
    return new NextResponse('Credenziali di accesso non configurate', {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  const authorization = request.headers.get('authorization') || ''
  if (authorization.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8')
      const separator = decoded.indexOf(':')
      if (separator > -1) {
        const receivedUser = decoded.slice(0, separator)
        const receivedPassword = decoded.slice(separator + 1)
        if (equals(receivedUser, user) && equals(receivedPassword, password)) {
          return NextResponse.next()
        }
      }
    } catch {
      // Header non valido, restituiamo un challenge Basic Auth.
    }
  }

  return new NextResponse('Inserisci le credenziali 2Night', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="2Night Inspector", charset="UTF-8"',
      'Cache-Control': 'no-store, private',
    },
  })
}

export const config = {
  matcher: ['/:path*'],
}
