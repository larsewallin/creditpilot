## What is this?

CreditPilot is an open-source project exploring how AI agents can automate credit and risk management for companies that sell on trade terms. It's a project built to show what this kind of system could look like in practice.

[GitHub repo →](https://github.com/larsewallin/creditpilot)

---

## How it works

Think of it as a team of always-on analysts, each watching one specific thing.

One reads the news. Every few hours it scans for stories about every company in a portfolio, and the moment something concerning shows up, it writes a short, sourced note. Another reads SEC filings, catching covenant breaches, going-concern language, or executive departures the moment a public customer files one. A third watches accounts receivable: who's over their credit limit, who's overdue and by how much, who's quietly drifting from paying on time to paying late.

None of these analysts talk to each other. They all just write what they find into one shared log, called Credit Events. That's the raw feed of everything happening across a portfolio, in real time.

When something in that feed is serious enough to warrant a decision, it becomes a proposed Action: a specific recommendation, with its reasoning attached, waiting for someone to approve or reject. Nothing happens automatically. A human stays the decision-maker. CreditPilot's job is just making sure that moment doesn't get missed.

Then there's the Credit Intelligence Agent, the CIA, the one analyst that doesn't watch anything on its own. Its job is reading every note every other analyst has written and answering questions about it. Someone might ask "should we be worried about American Airlines?" That question goes to the CIA. It pulls together everything every analyst has ever written about that company and answers directly, with the actual source record behind every claim, never an invented citation.

The CIA will become more powerful as more analysts get hired. It only shows information that's backed by a real source in the data it has access to.

---

## Deploying it, and keeping data secure

The live demo runs on a fictional company with fictional data, hosted on this project's own infrastructure, so anyone can try it without any setup. The real design, though, is for a company to run this on its own data, in its own environment: its own Supabase project, deployed under its own account. None of that data would ever touch this project's infrastructure or anyone else's. It can also run entirely locally. Either way, the analysis happens on a company's own data, for its own eyes only.

---

## How it's actually built (for the curious)

CreditPilot is open source, so the "team of analysts" doesn't have to stay a metaphor. Anyone can go look at the code. Here's the real structure, in plain terms.

The analysts are independent programs, called agents, not one big AI. Each one is a small, focused service, technically a Supabase Edge Function, that does exactly one job. More analysts can and will be "hired" to continue growing this credit management orchestration.

The AR Aging Agent watches accounts receivable: overdue balances broken into age buckets, credit utilization, and payment-behavior trends. The News Monitor Agent searches for and classifies negative news on every customer in a portfolio. The SEC Filing Monitor Agent pulls filings directly from the SEC's EDGAR system for public customers and scans them for risk language. The Credit Intelligence Agent, the CIA, is the synthesis layer. It doesn't watch anything on its own. It reads what the other three have written and answers questions in plain English, with sources.

The agents don't call each other directly. Each monitoring agent writes its findings into one shared table of events, and the CIA reads that table. This keeps every agent simple and independently testable. An agent's only job is to watch its one thing and write down what it finds, in a standard format. Nothing more.

Every event has a real source. When the CIA cites something as evidence, it's built directly from the actual records in the database, never generated freeform by the AI. If there's no real event to point to, it won't invent a source to fill the gap.

Nothing gets guessed about who a customer is. When CreditPilot needs to match uploaded data, like an AR aging file from an accounting system, to a customer in a portfolio, it uses real identifiers, like an internal customer code or a D-U-N-S number, rather than approximate name-matching. If it can't confirm a match with certainty, it rejects that row rather than risk attaching the data to the wrong company.

The team of analysts described above is not a fixed team. It's a pattern, documented specifically so new analysts can be added, by the project's maintainer or by anyone else, without redesigning the system.

A new agent is just a new watcher that follows the shared contract. It's a self-contained function that watches one thing, a data source, an API, a feed. It writes what it finds into the same shared event log every other agent uses, in the same standard shape. It respects the same demo and live separation, so it's safe to test without touching real data. Once it's writing events correctly, the CIA can already read and reason about its findings, with no changes needed to the CIA itself.

That last point is the real payoff of the design. The CIA gets smarter automatically as more analysts are added, because it already knows how to read the shared event format. New agents such as a Payment Behavior Analyst, a Country Risk Analyst, an Industry Downturn Monitoring Analyst, or an FX Exposure Analyst would each plug into the same slot the existing three occupy.

The repo's CONTRIBUTING.md walks through the exact steps and conventions, how to write events, how rate-limiting and audit logging are handled, so a new agent behaves consistently with the existing ones from day one. Anyone can also help shape the roadmap by opening an issue describing what kind of risk signal they'd want CreditPilot to watch, which becomes a candidate for the next analyst.

This also means CreditPilot isn't locked to one vendor's data or one company's roadmap. Anyone running their own instance can add the specific signals that matter for their industry or their portfolio, on top of the same foundation.

---

## What you see when you use it

Credit Events is the live feed of what every analyst is writing. New events appear as the agents detect them, each one showing the customer, what happened, the source, the severity, and the date, filterable by customer, severity, or event type. It's the situational awareness layer, showing what's happening across a portfolio right now.

Actions is where proposed recommendations wait for review, each one tied back to the specific events that triggered it.

AR Aging shows accounts receivable broken down by age bucket, credit utilization, and overdue exposure per customer, kept current as new AR data comes in.

News Monitor, SEC Filings, and Customers are filtered views into the underlying data each analyst produces.

And in the middle of all of it is the CIA, accessible from anywhere through a search bar for asking questions in plain English. It's the conversational layer over everything else.

---

## Who's building this

I have spent the last two decades in trade and receivables finance. By day I work in trade credit insurance at Coface and at night I take a stab at this project to try and push the limits on what's possible to build. I'm not married to a specific model, but this project has been built mainly using Claude Code.

Follow along as new agents ship, or reach out if trade credit insurance is relevant to your business.

Let's connect! [Connect on LinkedIn](https://www.linkedin.com/in/larsewallin/)
