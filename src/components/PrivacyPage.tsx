import { Link } from 'react-router-dom'
import './PrivacyPage.css'

/**
 * Public privacy policy — reachable without signing in (/privacy).
 * Required for publishing the Google OAuth consent screen.
 */
export default function PrivacyPage() {
  return (
    <div className="privacy-page">
      <main className="privacy-card">
        <header>
          <h1>Archivarius privacy policy</h1>
          <p className="privacy-updated">Last updated: 14 November 2026</p>
        </header>

        <section>
          <h2>What Archivarius is</h2>
          <p>
            Archivarius is a worldbuilding notebook: you create projects ("worlds") of pages,
            maps and timelines, alone or with people you invite.
          </p>
        </section>

        <section>
          <h2>What we store</h2>
          <ul>
            <li><strong>Account:</strong> your email address and a hashed password, or — if you
              sign in with Google — the email address and basic profile Google shares. We never
              see your Google password.</li>
            <li><strong>Content:</strong> the worlds, pages, images and plugin files you create
              or upload. Content is visible only to the members of its world, according to the
              role its owner gave them.</li>
          </ul>
        </section>

        <section>
          <h2>What we don't do</h2>
          <ul>
            <li>No ads, no analytics trackers, no selling or sharing of data with third parties.</li>
            <li>No use of your content for anything except showing it to you and your world's members.</li>
          </ul>
          <p>
            Cookies and local storage are used only to keep you signed in and remember interface
            preferences (like a collapsed sidebar).
          </p>
        </section>

        <section>
          <h2>Where it lives</h2>
          <p>
            Data is stored with our hosting providers (Supabase for the database, authentication
            and file storage; Cloudflare Pages serves the app). They process it only to run the
            service.
          </p>
        </section>

        <section>
          <h2>Deleting your data</h2>
          <p>
            Deleting a world permanently removes its pages and uploads. To delete your account
            and everything it owns, contact the operator of this instance.
          </p>
        </section>

        <footer className="privacy-footer">
          <Link to="/">← Back to Archivarius</Link>
        </footer>
      </main>
    </div>
  )
}
