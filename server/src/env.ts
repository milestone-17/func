export interface Env {
  port: number
  databaseUrl: string
  jwtSecret: string
  smtpHost?: string
  smtpPort: number
  smtpUser?: string
  smtpPass?: string
  smtpFrom?: string
  githubClientId?: string
  githubClientSecret?: string
  adminEmail?: string
  appUrl: string
  isProd: boolean
}

export function loadEnv(): Env {
  const port = Number(process.env.PORT || 3000)
  const databaseUrl = process.env.DATABASE_URL || ''
  const jwtSecret = process.env.JWT_SECRET || ''
  if (!databaseUrl) throw new Error('DATABASE_URL is required')
  if (!jwtSecret) throw new Error('JWT_SECRET is required')
  return {
    port,
    databaseUrl,
    jwtSecret,
    smtpHost: process.env.SMTP_HOST,
    smtpPort: Number(process.env.SMTP_PORT || 465),
    smtpUser: process.env.SMTP_USER,
    smtpPass: process.env.SMTP_PASS,
    smtpFrom: process.env.SMTP_FROM || process.env.SMTP_USER,
    githubClientId: process.env.GITHUB_CLIENT_ID,
    githubClientSecret: process.env.GITHUB_CLIENT_SECRET,
    adminEmail: process.env.ADMIN_EMAIL,
    appUrl: process.env.APP_URL || `http://localhost:${port}`,
    isProd: process.env.NODE_ENV === 'production'
  }
}
