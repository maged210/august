// /privacy — a real static route, written from what the code actually does.
//
// EVERY CLAIM HERE WAS READ OUT OF THE CODEBASE, not generated from a
// template. The key namespaces are the ones lib/* actually writes; the
// third-party list was verified call site by call site, and three services
// the owner believed were integrated (Kalshi, Polymarket, Financial Modeling
// Prep) are NOT and are therefore not listed.
//
// THIS IS A DRAFT. It has not been reviewed by a lawyer.

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "AUGUST — privacy",
  description: "What AUGUST stores, what leaves the system, and how to delete your account.",
};

export const dynamic = "force-static";

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <article className="legal">
        <h1>Privacy</h1>
        <p className="legal-sub">
          Last updated 11 September 2026. This page describes what AUGUST actually stores and
          sends. If the code and this page ever disagree, the code is the bug.
        </p>

        <h2>What AUGUST collects</h2>
        <p>
          <strong>Your email address</strong>, only if you sign in. Sign-in is an email magic
          link. There is no password, no social login, and no profile. The stored account record
          is your email, an internal id, and the time the link was verified.
        </p>
        <p>
          <strong>An anonymous device id</strong> (<code>aug_vid</code>), set as a cookie the
          first time you use a feature that needs to tell devices apart, such as taking a side on
          THE CALL or playing the PIT. It is a random identifier. It is not derived from you, it
          is not shared, and it is not used for advertising. If you later sign in, the device&apos;s
          state is folded into your account once.
        </p>
        <p>
          <strong>What you do on the desk</strong>, tied to your account or device id: your side
          on THE CALL and your running record, your PIT and Training progress and scores, your
          watchlist, your feed preferences, and whether you have completed first-run setup.
        </p>
        <p>
          <strong>Push subscriptions</strong>, only if you turn notifications on. That is the
          endpoint URL your browser vendor issues plus the two keys needed to encrypt a message
          to it.
        </p>
        <p>
          <strong>What you type into the command bar</strong>, when it is a question rather than a
          command. Commands are resolved locally and never leave the server. Questions are sent to
          Anthropic to be answered, and the answer is cached for ten minutes so an identical
          question is not re-sent.
        </p>
        <p>
          <strong>Your IP address</strong>, transiently, for rate limiting. It is used as a key to
          count requests in a rolling sixty-second window and is not stored alongside your account.
        </p>

        <h2>What AUGUST does not collect</h2>
        <p>
          There is no analytics, no telemetry, no tracking pixel, no session replay, no
          error-reporting SDK, and no advertising or attribution script anywhere in this
          application. Nothing profiles you across sites. Your data is never sold or shared for
          marketing, because there is no mechanism here to do it.
        </p>

        <h2>Where it is stored</h2>
        <p>
          Account records, desk state and push subscriptions live in a hosted Redis database
          (Upstash). The application runs on Vercel, which as the host processes every request,
          including your IP address and user agent, in its logs.
        </p>
        <p>
          Some preferences never leave your browser at all: your theme, accent, sidebar state,
          rain density, practice balance, and an in-progress PIT run are kept in your
          browser&apos;s own storage.
        </p>

        <h2>Who else receives anything</h2>
        <p>These are the services AUGUST actually talks to, and what reaches each one.</p>
        <ul className="legal-list">
          <li>
            <strong>Vercel</strong> — the host. Receives every request, including IP, user agent
            and cookies.
          </li>
          <li>
            <strong>Upstash</strong> — the database. Holds everything in the section above.
          </li>
          <li>
            <strong>Resend</strong> — sends the sign-in email. Receives your email address.
          </li>
          <li>
            <strong>Anthropic</strong> — answers questions asked in the command bar. Receives the
            text of your question. Do not type anything into it you would not want sent to a third
            party.
          </li>
          <li>
            <strong>Your browser vendor&apos;s push service</strong> (Google, Mozilla, Apple or
            Microsoft, depending on your browser) — delivers notifications if you enable them. The
            message body is encrypted before it is sent.
          </li>
          <li>
            <strong>TradingView</strong> — renders one chart widget in the owner desk. This one
            runs in your browser, so TradingView sees your IP address directly.
          </li>
          <li>
            <strong>Market and news sources</strong> — Yahoo Finance, FRED, Finnhub, CoinGecko,
            Coinbase, the US Geological Survey, OpenSky, an economic calendar mirror, a
            crypto sentiment index, CNN&apos;s market sentiment data, and public RSS feeds from
            news publishers. These are all fetched by the server. They receive a ticker, a date
            range or nothing at all. None of them receives anything about you.
          </li>
          <li>
            <strong>Supadata and YouTube</strong> — used by the owner to turn a public video link
            into a transcript. Receives a video link. No visitor data.
          </li>
        </ul>
        <p>
          For the avoidance of doubt: AUGUST does <strong>not</strong> integrate Kalshi,
          Polymarket, or Financial Modeling Prep, and does not use Google Fonts at runtime.
        </p>

        <h2>How long it is kept</h2>
        <p>
          Account and desk state is kept until you delete it. Sign-in links expire shortly after
          they are issued. The ten-minute question cache and the sixty-second rate-limit counters
          expire on their own. Notification delivery records are kept for the last fourteen days.
          Transcripts the owner ingests are capped at the most recent hundred.
        </p>

        <h2>Deleting your account</h2>
        <p>
          Sign in, open the account panel, and choose to delete. You will be asked to confirm.
          Deletion removes your account record, your sign-in tokens, your THE CALL picks and
          record, your PIT and Training progress, your watchlist and preferences, and your push
          subscriptions. It cannot be undone.
        </p>
        <p>
          Two honest limits. Host request logs at Vercel are outside this application&apos;s
          control and expire on Vercel&apos;s own schedule. And anything stored only in your own
          browser is cleared by clearing your browser data, not by the delete button.
        </p>

        <h2>Contact</h2>
        <p>
          AUGUST is run by one person. Questions about this page or about your data go to the
          address on the sign-in screen.
        </p>

        <p className="legal-foot">
          <Link href="/terms">Terms</Link> · <Link href="/">Back to the desk</Link>
        </p>
      </article>
    </main>
  );
}
