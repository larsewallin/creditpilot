## What is this?

CreditPilot is an open-source credit management app for companies that sell on credit terms. A team of AI agents watches a customer portfolio, writes down what it finds, and proposes decisions for a person to approve.

[GitHub repo →](https://github.com/larsewallin/creditpilot)

---

## How it works

Think of a team of always-on analysts, each watching one thing. On a schedule the credit team sets, each writes a short, sourced note when it finds something concerning:

- **AR aging:** who is overdue, by how much, and who is close to or over their credit limit.
- **Payments:** whether a customer pays later (or earlier) in the last 90 days than in the 90 days before.
- **News:** stories that name a customer.
- **SEC filings:** going-concern doubts, covenant waivers, executive departures at public customers.
- **Credit score:** a score falling, or financial statements getting too old.
- **Industry:** economic data and news for each sector in the portfolio, knowing that a falling price hurts the sector that sells and helps the sector that buys.
- **Country and FX:** political and economic events, rating and rate changes, tariffs, and currencies moving against open invoices.
- **Risk:** maps the industry, country and currency findings onto the customers actually exposed to them.

Each analyst works on its own and writes into one shared log, **Credit Events**: the feed of everything happening across the portfolio. Every event has a severity (see below).

When the warning signs about a customer add up, the app proposes an **Action**, for example a lower credit limit, with its reasoning and the events behind it. Nothing changes until a person approves it.

The **Credit Intelligence Agent (CIA)** watches nothing itself. It reads what the others wrote and answers questions in plain English from the chat bar at the bottom of every page, such as "Should I reduce Marlow Industrial Castings' credit limit?" Every claim points to the record behind it; totals and counts are calculated by the app, not by the AI. It gets more useful with every analyst added, without changes to the CIA.

---

## The pages

- **Credit Events:** the feed. Filter by severity, source, period or customer, or show only the **Customer summaries** (customers flagged by several agents).
- **Actions:** proposed decisions waiting for approval, each linked to the events behind it.
- **Customers, AR Aging, Payment Behaviour, News, SEC Filings:** each analyst's data, customer by customer.
- **Industry, Country and FX Risk:** the sectors, countries and currencies the portfolio is exposed to, and what changed.
- **New customers:** onboarding a new account. The company is looked up in official registers (Company Lookup), screened against sanctions lists, scored from the credit provider's report the credit team attaches (D&B, Creditsafe, Coface, Allianz Trade, Experian…), and given a proposed limit for a credit manager to approve. Customers never use CreditPilot themselves.
- **Settings:** the company's rules (which score comes first, how old financial statements may be, when each agent runs) and **Connectors**, every data source and whether it is connected.

---

## How severity works

Every finding has one of the same levels, everywhere in the app.

| Severity | What it means | What to do |
|---|---|---|
| **Critical** | A serious problem now: the customer could fail to pay. | Act today: review the limit, hold new orders, call the customer. |
| **High** | A clear warning sign. | Review this week. |
| **Medium** | Something to watch. | Keep an eye on it; it counts if other signs appear. |
| **Low** | Minor or early. | Noted; no action needed on its own. |

Good news, such as a customer paying faster, is recorded as low or as information only.

Each agent sets severity by fixed rules, so the same facts always give the same level. Some examples:

- **AR aging:** critical when a customer is over its credit limit or has invoices more than 90 days overdue; high at 61–90 days, or above 80% of the limit when other signs are weak; medium at 31–60 days; low at 1–30 days.
- **Payments:** critical when a customer pays 20 or more days later than before; high at 10–20 days; medium when slightly later.
- **SEC filings:** critical for a going-concern doubt; high for a covenant waiver or a CEO departure; medium for other warnings.
- **Credit score:** critical for a fall of 30 points or more; high at 20; medium at 10; low below that.
- **Exchange rates:** critical when an invoice currency moved 10% or more against you in 30 days; high at 6%.
- **News:** each story is rated on how directly it threatens the customer's ability to pay.

When several agents flag the same customer, the CIA writes one **Several warning signs** card, rated at the severity of its most serious signal. It weighs an Action, such as a lower limit, when limit use reaches the policy's action level (75% by default, lower for each warning sign), when three or more agents flag the customer, or when its score is High risk; the policy then sets how large the cut is. A customer in bankruptcy gets a hold at $0.

---

## The demo, and running it on your own data

**The demo** runs on a sample portfolio, so anyone can try it without setup. On the sign-in page, try it as a credit manager, a credit analyst or a sales rep. Every company in it is fictional, and so is every score, limit, invoice, payment, event and news item. The demo is shared by every visitor and replays the same story each day with today's dates. New customers (onboarding) is not available in the demo; it works on your own CreditPilot. Real in the demo: the CIA's answers, written live by an AI model (10 questions a day per visitor).

**Your own data** stays yours: a company runs CreditPilot in its own Supabase project, or entirely locally, and nothing touches this project's infrastructure. The repo's RUN_IT_YOURSELF guide covers both.

---

## How it's built (for the curious)

Each analyst is a small, independent program (a Supabase Edge Function) that does one job and writes its findings into the shared event log in a standard shape. Agents never call each other, so each one stays simple and testable on its own.

A few rules hold everywhere:

- **Real sources only.** A citation in a CIA answer is built from an actual record in the database, never generated by the AI.
- **No AI arithmetic.** Totals, counts and lists are computed by the app; the AI explains them.
- **Customer identity is never guessed.** Uploaded data (an AR file from an accounting system, say) is matched on real identifiers such as a customer code or DUNS number; a row that can't be matched for certain is rejected.

New analysts can be added by anyone: a new agent watches one source and writes events in the same shape, and the CIA can read them straight away. CONTRIBUTING.md has the steps. To suggest the next one, open an issue describing the risk signal you'd want watched.

---

## Who's building this

Hi, I'm Lars. I've spent the last two decades in trade and receivables finance, and I started this project to push the limits of what's possible to build. I'm not married to a specific model, but it has been built mainly with Claude Code.

I believe agents will run a big part of companies' finance and operations. This is a way to explore what that could look like: the advantages and the challenges of building internal tools with AI.

Follow along as new agents ship, or reach out if you're exploring something similar at your own company. [Connect on LinkedIn](https://www.linkedin.com/in/larsewallin/)
