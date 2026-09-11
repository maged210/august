// /terms — a real static route. Written from what the product actually is:
// a desk that publishes dated directional calls, and two simulated games.
//
// THIS IS A DRAFT. It has not been reviewed by a lawyer.

import type { Metadata } from "next";
import Link from "next/link";
import { DISCLAIMER_CALLS, DISCLAIMER_SIM } from "@/lib/disclaimer";

export const metadata: Metadata = {
  title: "AUGUST — terms",
  description: "Research and opinion, not investment advice. What AUGUST does and does not promise.",
};

export const dynamic = "force-static";

export default function TermsPage() {
  return (
    <main className="legal-page">
      <article className="legal">
        <h1>Terms</h1>
        <p className="legal-sub">
          Last updated 11 September 2026. Plain language, because the point is that you actually
          read it.
        </p>

        <h2>Research and opinion, not investment advice</h2>
        <p>{DISCLAIMER_CALLS}</p>
        <p>
          AUGUST publishes dated directional calls, entry levels, targets and stops, and a daily
          read on market conditions. All of it is one desk&apos;s opinion, published openly so it
          can be judged against what actually happened. None of it is a recommendation to buy or
          sell anything, and none of it is tailored to you, your finances, or your goals.
        </p>

        <h2>No adviser relationship</h2>
        <p>
          Using AUGUST does not make anyone your broker, your investment adviser, or your
          fiduciary. No relationship of trust or reliance is created by reading it, subscribing to
          notifications, or holding an account. AUGUST does not know your circumstances and does
          not take them into account.
        </p>

        <h2>Your trades are yours</h2>
        <p>
          Every decision you make in a real market is your own, and so is every outcome. If you act
          on something you read here and lose money, that loss is yours. Consider talking to a
          licensed professional who is actually able to advise you.
        </p>

        <h2>The PIT and the Training floor are simulated</h2>
        <p>{DISCLAIMER_SIM}</p>
        <p>
          Both are games played against recorded or generated tapes. No real order is ever placed,
          no real money is ever at risk, and no result there predicts anything about a real market.
          Scores, streaks and records are entertainment.
        </p>

        <h2>No guarantee of accuracy</h2>
        <p>
          Prices, levels and market data come from free third-party sources and are frequently
          delayed. They can be wrong, stale, or missing. AUGUST labels data it cannot stand behind
          rather than filling the gap, but it cannot guarantee any figure is correct or current.
          Calls are generated from a model and from the owner&apos;s own reading, and both are
          regularly wrong. The published win-loss record exists precisely because they are.
        </p>

        <h2>No guarantee of uptime</h2>
        <p>
          AUGUST is provided as-is and as-available, with no warranty of any kind. It may be
          unavailable, interrupted, delayed, or discontinued at any time, without notice. Features
          may change or be removed. Notifications may not arrive. Do not build anything that
          depends on it.
        </p>

        <h2>Limitation of liability</h2>
        <p>
          To the fullest extent the law allows, AUGUST and its operator are not liable for any
          trading loss, lost profit, lost data, or any indirect or consequential damage arising
          from your use of the site or your reliance on anything published on it.
        </p>

        <h2>Using the site</h2>
        <p>
          Do not attempt to break, overload, or gain unauthorised access to the site or to other
          people&apos;s accounts. Rate limits exist and are enforced. The published feeds may be
          read, but the calls remain the desk&apos;s work — if you republish them, say where they
          came from and carry the disclaimer with them.
        </p>

        <h2>Your account</h2>
        <p>
          You may delete your account at any time from the account panel, and doing so is
          permanent. AUGUST may suspend or remove an account that is being used to abuse the
          service.
        </p>

        <h2>Changes</h2>
        <p>
          These terms may change. The date at the top says when they last did. Continuing to use
          AUGUST after a change means you accept it.
        </p>

        <p className="legal-foot">
          <Link href="/privacy">Privacy</Link> · <Link href="/">Back to the desk</Link>
        </p>
      </article>
    </main>
  );
}
