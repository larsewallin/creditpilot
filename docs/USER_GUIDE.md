# What CreditPilot Does
### A guide for users trying it for the first time

---

## The problem you already know

You sell to other businesses. Some are giants like Boeing. Some are smaller suppliers in your industry. Either way, when you ship them parts or services, you don't get paid that day. You get paid 30, 60, sometimes 90 days later.

While you wait, you're carrying their risk. If one of your big customers goes bankrupt before paying, that's not just a missed payment — that's potentially a six- or seven-figure write-off. And it doesn't take a recession. Triumph Group, a real aerospace company, filed warning signals across multiple credit watchers in the past year. A supplier who didn't notice in time would have been exposed.

You have credit policies. You have a credit team. You have insurance, maybe. But here's the honest situation in most credit departments: a small team is trying to watch hundreds or thousands of customers across dozens of industries, reading news, checking SEC filings, looking at payment patterns, talking to references. Things get missed. Not because anyone is careless — because there's too much to watch and not enough hours.

CreditPilot is built for that exact problem.

---

## What CreditPilot actually is

Think of it as a team of always-on analysts, each watching one specific thing.

One analyst's job is reading the news. Every few hours, it searches for stories about every company in your portfolio. When it spots something concerning — an earnings miss, a downgrade, a layoff announcement — it writes a short note that includes the source, the date, and a severity rating.

Another analyst is reading SEC filings. When a public customer files quarterly reports, 8-Ks, or anything that suggests trouble — covenant breaches, going-concern language, executive departures — it catches it and writes a note.

Another is watching your accounts receivable. Every time your AR data updates, it checks: who's over their credit limit? Who has overdue balances, and how much, and in which age bucket? It also tracks whether customers are paying on time or drifting later, so a slow-motion deterioration doesn't slip by unnoticed.

These analysts don't talk to each other. They all just write their notes into one place — a shared event log. Then there's one final analyst — the Credit Intelligence Agent, the CIA — whose job is reading every note from every other analyst and answering your questions.

When you ask CreditPilot "should I be worried about American Airlines?" you're talking to the CIA. It pulls together every note about American Airlines from every analyst, gives you a structured answer, and shows you the actual source record behind every claim it makes — never an invented citation, only what's really in the data.

---

## How it's actually built (for the curious)

CreditPilot is open source, so you don't have to take "team of analysts" as a metaphor — you can go look at the code. Here's the real structure, in plain terms.

**The analysts are independent programs ("agents"), not one big AI.** Each one is a small, focused service — technically a Supabase Edge Function — that does exactly one job:

- **AR Aging Agent** — watches your accounts receivable: overdue balances (broken into age buckets), credit utilization, and payment-behavior trends.
- **News Monitor Agent** — searches for and classifies negative news on every customer in your portfolio.
- **SEC Filing Monitor Agent** — pulls filings directly from the SEC's EDGAR system for public customers and scans them for risk language.
- **Credit Intelligence Agent (CIA)** — the synthesis layer. It doesn't watch anything on its own; it reads what the other three have written and answers your questions in plain English, with sources.

**They don't call each other directly.** Each monitoring agent writes its findings into one shared table of events. The CIA reads that table. This keeps every agent simple and independently testable — an agent's only job is "watch your thing, write down what you find, in a standard format." Nothing more.

**Every event has a real source.** When the CIA cites something as evidence, it's built directly from the actual records in the database — never generated freeform by the AI. If there's no real event to point to, it won't invent a source to fill the gap.

**Nothing gets guessed about who a customer is.** When CreditPilot needs to match uploaded data — like an AR aging file from your accounting system — to a customer in your portfolio, it uses real identifiers (like your internal customer code, or a D-U-N-S number) rather than approximate name-matching. If it can't confirm a match with certainty, it rejects that row rather than risk attaching your data to the wrong company.

**Demo data and live data are kept honestly separate.** Every row every agent writes is tagged as demo or real. This isn't cosmetic — it means what you see in a demo walkthrough is never mixed with what your own portfolio produces.

---

## It's open source — and built to grow

CreditPilot's code is public: [github.com/larsewallin/creditpilot](https://github.com/larsewallin/creditpilot). That's a deliberate choice, not just a convenience.

The "team of analysts" you read about above is not a fixed team. It's a pattern — and the pattern is documented specifically so that new analysts can be added, by us or by anyone else, without redesigning the system.

**A new agent is just a new watcher that follows the shared contract:**
1. It's a self-contained function that watches one thing (a data source, an API, a feed).
2. It writes what it finds into the same shared event log every other agent uses, in the same standard shape.
3. It respects the same demo/live separation, so it's safe to test without touching real data.
4. Once it's writing events correctly, the CIA can already read and reason about its findings — no changes needed to the CIA itself.

That last point is the real payoff of the design: **the CIA gets smarter automatically as more analysts are added**, because it already knows how to read the shared event format. Someone could add a Payment Behavior Monitor, a Country Risk Monitor, an Industry Downturn Monitor, an FX Exposure watcher — each one plugs into the same slot the existing three occupy.

If you're technical and want to build one, the repo's `CONTRIBUTING.md` walks through the exact steps and conventions (how demo mode works, how to write events, how rate-limiting and audit logging are handled) so a new agent behaves consistently with the existing ones from day one. If you're not technical, you can still shape the roadmap — open an issue describing what kind of risk signal you wish CreditPilot watched, and it becomes a candidate for the next analyst.

This also means CreditPilot isn't locked to one vendor's data or one company's roadmap. Anyone running their own instance can add the specific signals that matter for their industry or their portfolio, on top of the same foundation.

---

## Why this is different from what you have today

Most credit tools you've seen are dashboards. They show you the data. They put colored dots next to customer names. They generate reports. The decision is yours.

CreditPilot is built to do more than show. The analysts don't just flag things — when something serious is developing, the goal is to surface a specific, actionable recommendation with its reasoning attached: what changed, which records support it, and what action might make sense. That recommendation is meant for a real human — you, or someone on your team — to review, not to act on its own.

The other thing it does that dashboards don't: it answers questions in your own words. You don't need a custom report. You just ask. "Which customers in aerospace have the highest concentration risk?" "Has anyone had a credit downgrade this quarter?" "What's my total exposure to the auto sector?" The CIA reads everything the other analysts have written and gives you a structured, sourced answer — like a credit analyst would, except in seconds.

**A note on where the product is today versus where it's headed:** the recommendation-and-review workflow is actively being built out. Some parts of it — the event feed, the sourced Q&A, the AR aging detection, the news and filing monitors — are live and working end-to-end. Others, like a full closed-loop system that learns from every approval or rejection you make over time, are still on the roadmap. This guide will be kept honest about that line as the product evolves — if something's described here as "coming," it means genuinely not built yet, not "built but hidden."

---

## What you see when you use it

**Credit Events** — the live feed of what every analyst is writing. New events appear as the agents detect them. Each one shows the customer, what happened, the source, the severity, and the date. You can filter by customer, by severity, by event type. This is your situational awareness — what's happening across the portfolio right now.

**AR Aging** — your accounts receivable broken down by age bucket, credit utilization, and overdue exposure per customer, kept current as new AR data comes in.

**News Monitor, SEC Filings, Customers** — exactly what they sound like. Filtered views into the underlying data each analyst is producing.

And in the middle of all of it, the CIA — accessible from anywhere via a search bar where you can ask questions in plain English. The CIA is the conversational layer over everything else.

---

## What it doesn't do (yet, or ever)

A few things worth being clear about.

**It doesn't replace your credit judgment.** It surfaces signals and, where relevant, proposed actions. You decide. CreditPilot is designed to make you faster and more thorough, not to take you out of the loop.

**It doesn't catch everything.** No system does. A customer who quietly falls behind without triggering any of the signals CreditPilot watches will still be missed. The goal isn't omniscience — it's catching the cases that have visible warning signs a small team can't track manually across a large portfolio.

**It doesn't predict the future.** It synthesizes what's known right now. If a customer is about to declare bankruptcy tomorrow but nothing public suggests it today, CreditPilot won't warn you. What it *will* do is catch the kind of preventable misses that come from "we knew about the bad earnings call but didn't connect it to the missed payment two weeks later."

**It's not a replacement for credit insurance, ratings agencies, or trade references.** It works *with* those — pulling their signals in, organizing them, helping you act on them. CreditPilot makes your existing tools more useful, not redundant.

---

## How to think about the trust question

You're letting software watch your customer portfolio and, in time, propose actions on it. That's a big ask. A few things to know.

Every claim is traceable. When the CIA tells you something about a customer, you can see exactly which underlying record — a news article, a filing, an AR event — it came from. Nothing is asserted without a source behind it.

You can override anything. If CreditPilot flags a customer and you know context the system doesn't (a relationship, a guarantee, a recent conversation), that's your call to make — the system surfaces information, it doesn't make the decision for you.

The data stays yours. CreditPilot can pull from your existing systems — your ERP, your invoice records — but it doesn't share them outside your environment. The analyses are computed on your data, for your eyes only. And because it's open source, you can also self-host it and control that boundary directly.

---

## Who this is for

You manage credit at a mid-sized to large company that sells on terms. You have customers ranging from rock-solid public companies to riskier private firms. Your portfolio is bigger than you can comfortably watch with the people you have. You're tired of being the last to know when a customer is in trouble.

You may not be technical. You don't need to be. CreditPilot is designed to read the same way a smart credit analyst would talk — clear language, specific facts, cited sources, honest about what it doesn't know.

You might use it daily. You might use it once a week when you're reviewing the portfolio. Either way, the system is working continuously in the background, and what you see is the synthesis of that work, ready when you are.

If you're technical and curious how it's put together — or want to extend it — the code, architecture docs, and contribution guide are all in the public repo.

---

## Where to start

When you log in for the first time, the system will show you a portfolio briefing — a summary of what the agents have been watching and what looks most worth your attention right now. That's the entry point.

From there, the natural next step is to ask the CIA a question about something the briefing highlighted. Type into the search bar. Try a real question: "What's driving Triumph Group's risk profile?" or "Which customers should I review this week?" See how the system answers.

You'll get a feel for what it does well, what it surfaces, and how it sources its answers. From there, the workflow becomes natural: scan the briefing, check the event feed, ask follow-up questions where something catches your eye.

---

That's the picture. Welcome to a credit team that never sleeps.
