/* =========================================================
   Christian Bolorinos — Onboarding chatbot + personalization
   Asks two questions, then reorders & highlights the About,
   Portfolio, Resume and Skills sections to match the answers.
   ========================================================= */
(function () {
	'use strict';

	var STORE_KEY = 'cb-perso';           // sessionStorage: remembers this session
	var store = window.sessionStorage;

	/* ---------- AI resume filtering config ----------
	   Paste your n8n webhook URL here to enable live Claude filtering.
	   Leave it as '' and the site uses a built-in keyword fallback instead,
	   so the feature works either way. */
	var RESUME_WEBHOOK = 'https://gomdeeu.app.n8n.cloud/webhook/resume-filter';
	var KEEP_THRESHOLD = 55;   // bullets scoring >= this are kept
	var MIN_BULLETS = 2;       // every role always shows at least this many
	var FETCH_TIMEOUT = 6000;  // ms before falling back to local scoring

	// Onboarding "Other" reconciler: Claude suggests closer-matching categories
	var RECONCILE_WEBHOOK = 'https://gomdeeu.app.n8n.cloud/webhook/onboarding-reconcile';
	var SKILL_VALS = ['design', 'strategy', 'research', 'creative', 'automation'];
	var SECTOR_VALS = ['fintech', 'events', 'wellness', 'delivery', 'learning', 'legal', 'relocation', 'industrial', 'corporate'];

	/* ---------- Questions ----------
	   Options flagged `hidden: true` are never offered as buttons. They exist so
	   the value stays a first-class category with a proper display label: the
	   reconcile webhook can suggest it, and a free-text "Other" answer can resolve
	   to it via the synonym maps below. That's how "AI & Automation" is reached —
	   only for visitors who actually ask about AI, automation, n8n, agents, etc. */
	var QUESTIONS = [
		{
			id: 'skill',
			text: 'What skills from Christian Bolorinos are you wanting to learn about?',
			options: [
				{ label: 'Product Design', val: 'design' },
				{ label: 'Product Strategy', val: 'strategy' },
				{ label: 'Creative Direction', val: 'creative' },
				{ label: 'UX Research', val: 'research', hidden: true },
				{ label: 'AI & Automation', val: 'automation', hidden: true },
				{ label: 'Other', val: 'other' }
			]
		},
		{
			id: 'sector',
			// `skippable` adds a "no preference" button below the options. A visitor
			// who only cares about the skillset can answer one question and go
			// straight to the portfolio; the sector dimension is simply left
			// unanswered, and every downstream scorer already treats a missing
			// sector as "don't weight it" rather than as an error.
			skippable: true,
			skipLabel: 'No preference &mdash; show me everything',
			text: 'What sector are you most interested in?',
			options: [
				{ label: 'Fintech', val: 'fintech' },
				{ label: 'Events', val: 'events' },
				{ label: 'Edtech', val: 'learning' },
				{ label: 'Wellness', val: 'wellness', hidden: true },
				{ label: 'Delivery & Logistics', val: 'delivery', hidden: true },
				{ label: 'Legal', val: 'legal', hidden: true },
				{ label: 'Relocation', val: 'relocation', hidden: true },
				{ label: 'Industrial', val: 'industrial', hidden: true },
				{ label: 'Corporate', val: 'corporate', hidden: true },
				{ label: 'Other', val: 'other' }
			]
		}
	];

	/* ---------- Synonyms to resolve free-text "Other" answers ---------- */
	var SKILL_SYN = {
		design: ['design', 'ui', 'ux', 'interface', 'product design', 'visual', 'prototyp', 'figma'],
		// 'research' deliberately does NOT live under strategy any more — it has its
		// own category now, and substring matching would swallow it first.
		strategy: ['strateg', 'growth', 'experiment', 'a/b', 'analytics', 'product manage', 'business', 'optimi'],
		research: ['research', 'user research', 'ux research', 'user interview', 'interview', 'usability', 'discovery', 'ethnograph', 'synthesis', 'user testing', 'insight', 'survey', 'qualitative', 'quantitative', 'field study', 'persona', 'journey map'],
		creative: ['creative', 'brand', 'motion', 'video', 'story', 'art', 'illustrat', 'direction', 'campaign', 'social'],
		automation: ['automat', 'n8n', 'agentic', 'agent', 'workflow', 'chatbot', 'no-code', 'nocode', 'zapier', 'make.com', 'generative ai', 'gpt', 'llm', 'artificial intelligence', 'ai-first', 'ai first', 'claude', 'openai', 'copilot', 'midjourney', 'prompt', 'machine learning']
	};
	/* Whole-word tokens, matched with word boundaries. Short ones like "ai" and
	   "ml" can't live in SKILL_SYN because that map uses substring matching and
	   "ai" would fire inside "email", "detail" and "campaign". */
	var SKILL_WORD_SYN = {
		automation: ['ai', 'ml', 'bot', 'bots', 'rpa', 'genai']
	};
	var SECTOR_SYN = {
		fintech: ['fintech', 'finance', 'financ', 'crypto', 'blockchain', 'bank', 'payment', 'money', 'remittance', 'web3', 'nft'],
		events: ['event', 'conference', 'festival', 'community', 'network', 'summit'],
		wellness: ['wellness', 'health', 'mindful', 'medita', 'retreat', 'wellbeing', 'spiritual', 'buddhis', 'yoga'],
		learning: ['edtech', 'ed-tech', 'education', 'educational', 'learning', 'elearning', 'e-learning', 'course', 'coursera', 'curricul', 'academ', 'school', 'universit', 'student', 'teach', 'tutor', 'training', 'mooc', 'lms'],
		// The remaining hidden sectors had no synonyms at all, so free text could
		// never reach them — they depended entirely on the reconcile webhook.
		delivery: ['delivery', 'courier', 'logistic', 'last-mile', 'last mile', 'rider', 'fleet', 'gig econom'],
		legal: ['legal', 'law firm', 'lawyer', 'attorney', 'litigation', 'counsel'],
		relocation: ['relocation', 'relocat', 'visa', 'immigration', 'expat', 'digital nomad'],
		industrial: ['industrial', 'manufactur', 'construction', 'heavy equipment', 'power tool'],
		// Not an industry so much as a shape of employer: big-brand, in-house,
		// long-cycle work. Used by the ?sector=corporate deep link below.
		corporate: ['corporate', 'enterprise', 'in-house', 'inhouse', 'b2b', 'internal comms', 'internal communication', 'professional services', 'consultanc', 'blue chip', 'blue-chip']
	};

	/* ---------- About Me copy ----------
	   Pre-written variants, swapped in wholesale — no network call, so the copy is
	   already correct on first paint and can never go off-message. Each variant
	   replaces three paragraphs: #aboutBio, #aboutWhatIDo and #aboutClose.
	   `dflt` is used whenever the visitor skips, or answers with a skill that
	   doesn't resolve to one of the four canonical categories. */
	var WHAT_I_DO_STANDARD = 'My work is built on three habits. I am data driven: every design decision I make is backed by analytics, A/B tests, or user interviews, and every project gets a KPI. I am human centered: I get as close to the user as I can, whether that means conducting user interviews or immersing myself in the demographics I&rsquo;m designing for. And I work AI-first: I use generative AI and automation (n8n, agentic workflows, Claude) to multiply output without diluting craft.';

	var ABOUT_VARIANTS = {
		dflt: {
			bio: 'I grew up between Madrid and California, and I&rsquo;ve spent the last 10 years working in product design, UX research, and emerging technology.',
			whatIDo: WHAT_I_DO_STANDARD,
			close: 'Trilingual, bicultural, and comfortable anywhere from product design to brand storytelling to front-end code.'
		},
		design: {
			bio: 'I grew up between Madrid and California, and I&rsquo;ve spent the last 10 years working in product design, UX research, and emerging technology.',
			whatIDo: WHAT_I_DO_STANDARD,
			close: 'Trilingual, bicultural, and comfortable anywhere from product design to product strategy to front-end code.'
		},
		strategy: {
			bio: 'I grew up between Madrid and California, and I&rsquo;ve spent the last 10 years working in product strategy, UX research, and emerging technology.',
			whatIDo: WHAT_I_DO_STANDARD,
			close: 'Trilingual, bicultural, and comfortable anywhere from product strategy to branding to optimization.'
		},
		research: {
			bio: 'I grew up between Madrid and California, and I&rsquo;ve spent the last 10 years working in UX research, product design, and emerging technology.',
			whatIDo: 'My work is built on three habits. I am data driven: every design decision I make is backed by analytics, A/B tests, or user interviews, and every project gets a KPI. I am human centered: I get as close to the user as I can &mdash; that has meant 30+ interviews a year at WSA, 4,000 customer emails at Hilti, and riding a bike around Madrid as a Deliveroo courier to understand the job I was designing for. And I work AI-first: I use generative AI and automation (n8n, agentic workflows, Claude) to multiply output without diluting craft.',
			close: 'Trilingual, bicultural, and comfortable anywhere from discovery research to product design to front-end code.'
		},
		creative: {
			bio: 'I grew up between Madrid and California, and I&rsquo;ve spent the last 10 years working in visual craft, communications, and emerging technology.',
			whatIDo: 'My work is built on three habits. I am data driven: every design decision I make is backed by data, and every project gets a KPI. I am human centered: I get as close to the target audience as I can, whether that means conducting interviews or immersing myself in the demographics I&rsquo;m designing for. And I work AI-first: I use generative AI and automation (n8n, agentic workflows, Claude) to multiply output without diluting craft.',
			close: 'Trilingual, bicultural, and comfortable anywhere from design to strategy to communications.'
		},
		automation: {
			bio: 'I grew up between Madrid and California, and I&rsquo;ve spent the last 10 years working in product design, automation, and emerging technology.',
			whatIDo: WHAT_I_DO_STANDARD,
			close: 'Trilingual, bicultural, and comfortable anywhere from product design to automation to front-end code.'
		}
	};

	/* One sentence appended to the END OF THE BIO paragraph. Sectors absent from
	   this map (legal, relocation, industrial) and any unresolved free-text
	   answer leave the bio as-is — no closing sentence at all. */
	var ABOUT_SECTOR_LINES = {
		fintech:  'This has included three years in Finance (specifically in cryptocurrencies, wealth management apps and remittances).',
		wellness: 'This has included five years in the wellness space.',
		events:   'This has included five years in events planning, event apps, and events branding.',
		delivery: 'This has included two years in working with delivery services.',
		learning: 'This has included five years in working in Edtech, with clients that have included IE Business School, 5Mins.ai, Coursera and University of Bristol.'
	};

	/* ---------- Tag maps ---------- */
	// Portfolio cards keyed by data-modal
	var PROJECT_TAGS = {
		summit:         { skills: ['design', 'strategy', 'research', 'automation'], sectors: ['events'] },
		wsa:            { skills: ['design', 'strategy', 'research'], sectors: ['events'] },
		m5mins:         { skills: ['design', 'strategy', 'research'], sectors: ['learning'] },
		nomads:         { skills: ['design', 'strategy', 'creative', 'automation'], sectors: ['legal', 'relocation'] },
		swissborg:      { skills: ['design', 'strategy', 'research'], sectors: ['fintech'] },
		hilti:          { skills: ['strategy', 'research'], sectors: ['industrial'] },
		riaUI:          { skills: ['design'], sectors: ['fintech'] },
		ria:            { skills: ['strategy', 'creative'], sectors: ['fintech'] },
		serviceclub:    { skills: ['strategy', 'research', 'creative'], sectors: ['learning', 'delivery'] },
		gomde:          { skills: ['strategy', 'automation'], sectors: ['wellness'] },
		holiday:        { skills: ['design', 'creative'], sectors: ['legal'] },
		kremsegg:       { skills: ['automation'], sectors: ['learning', 'wellness'] },
		gcbranding:     { skills: ['creative'], sectors: ['events'] }
	};

	/* ---------- Curated deep-link views ----------
	   The tag scorer can only reorder cards and reveal conditional ones. It has no
	   way to take a default-visible card OFF the page, which is what a curated
	   recruiter link needs: ?skill=design&sector=corporate is sent to employers who
	   should see the in-house client work and not the founder projects.

	   Two parallel maps — SECTOR_VIEWS keyed by resolved sector, SKILL_VIEWS by
	   resolved skill. Both use the same shape and are merged at apply time, so a
	   card listed in either view's `suppress` is dropped, and either's `feature`
	   pins it to the front.
	     suppress - data-modal keys removed from the grid entirely, default cards
	                included. Survives the portfolio filter tabs (see the
	                .card--suppressed rule in style.css) and is undone by reset().
	     feature  - data-modal keys pinned to the front of the grid, and revealed
	                even if they are conditional cards this view would not
	                normally unlock.
	   Everything else about the view stays default. */
	var SECTOR_VIEWS = {
		corporate: {
			suppress: ['nomads', 'hilti'],
			feature: ['gcbranding', 'ria']
		}
	};
	var SKILL_VIEWS = {
		strategy: { suppress: ['holiday', 'riaUI'] },
		creative: { suppress: ['hilti', 'wsa', 'kremsegg'] }
	};
	var FEATURE_BOOST = 6;   // outranks the 2 (skill) + 3 (sector) a tag match can score

	/* Cards that are hidden by default and only revealed for matching interests.
	   Reveal when skill = Creative Direction, sector = Events, or the visitor's
	   free-text mentions branding / visual identity / graphic / motion, etc. */
	var CONDITIONAL_KEYWORDS = ['brand', 'digital design', 'visual', 'identity', 'graphic', 'motion', 'event', 'congress', 'print', 'creative'];
	var WELLNESS_KEYWORDS = ['wellness', 'health', 'mindful', 'medita', 'retreat', 'wellbeing', 'spiritual', 'buddhis', 'yoga', 'spa'];
	var LEARNING_KEYWORDS = ['edtech', 'ed-tech', 'education', 'learning', 'elearning', 'e-learning', 'course', 'coursera', 'academ', 'school', 'universit', 'student', 'teach', 'training', 'curricul'];
	// Keyword sets referenced by each conditional card's data-reveal-kw attribute
	var KW_SETS = {
		branding: CONDITIONAL_KEYWORDS,
		wellness: WELLNESS_KEYWORDS,
		learning: LEARNING_KEYWORDS,
		// Service Club "super couriers" — an AI-video campaign. Shown only to
		// visitors who ask about creative direction or AI/automation.
		surfers: ['creative', 'motion', 'video', 'campaign', 'brand', 'social',
			'generative', 'generative ai', 'ai video', 'automat', 'n8n', 'agentic', 'midjourney', 'prompt'],
		// Kremsegg is a university site built for a Buddhist institution — it belongs
		// to both audiences, so it reveals on either keyword set.
		kremsegg: WELLNESS_KEYWORDS.concat(LEARNING_KEYWORDS)
	};
	// Resume experience entries matched by a keyword found in the <h4>
	var RESUME_TAGS = [
		// Drives only the gold outline on a role panel, so keep it to each role's
		// primary story — tagging every role with everything makes the marker mean
		// nothing. 'research' goes where the research IS the story: 30+ interviews
		// at WSA, riding as a courier at Service Club, the Hilti study in ventures.
		{ match: 'WSA',            skills: ['design', 'strategy', 'research'], sectors: ['events'] },
		{ match: '5Mins',          skills: ['design', 'strategy'],            sectors: ['learning'] },
		{ match: 'SwissBorg',      skills: ['design', 'strategy'],            sectors: ['fintech'] },
		{ match: 'Ria Money',      skills: ['creative', 'design', 'strategy'],sectors: ['fintech'] },
		{ match: 'Service Club',   skills: ['creative', 'strategy', 'research'], sectors: ['delivery', 'learning'] },
		{ match: 'Saturno',        skills: ['design', 'creative'],            sectors: ['legal'] },
		{ match: 'Independent Projects',skills: ['strategy', 'design', 'automation', 'research'],sectors: ['wellness', 'relocation', 'learning'] }
	];
	// Skills categories matched by a keyword found in the <h4>
	var SKILL_ITEM_TAGS = [
		{ match: 'Design',   skills: ['design', 'creative'] },
		{ match: 'Research', skills: ['research', 'strategy'] },
		{ match: 'Product',  skills: ['strategy'] },
		{ match: 'Web',      skills: ['design'] },
		{ match: 'AI',       skills: ['strategy', 'creative', 'automation'] },
		{ match: 'Languages',skills: [] }
	];

	/* ---------- Deep links ----------
	   A URL can pre-answer the onboarding, so a link sent to a recruiter opens on
	   exactly the version of the site you want them to see. Any of these work:

	     ?for=research                  → UX Research
	     ?for=design,fintech            → Product Design in Fintech
	     ?skill=design&sector=fintech   → the same, spelled out
	     ?for=ai                        → AI & Automation

	   Order doesn't matter — each value is resolved to a skill or a sector by
	   looking it up, so ?for=fintech,design behaves identically. Anything
	   unrecognised is ignored rather than breaking the page. */
	var URL_ALIASES = {
		'design': 'design', 'product-design': 'design', 'ui': 'design', 'ux-design': 'design', 'ux-ui': 'design',
		'strategy': 'strategy', 'product-strategy': 'strategy', 'growth': 'strategy', 'product': 'strategy',
		'research': 'research', 'ux': 'research', 'ux-research': 'research', 'user-research': 'research', 'usability': 'research', 'discovery': 'research',
		'creative': 'creative', 'creative-direction': 'creative', 'brand': 'creative', 'branding': 'creative', 'motion': 'creative', 'video': 'creative',
		'ai': 'automation', 'automation': 'automation', 'ai-automation': 'automation', 'agents': 'automation', 'n8n': 'automation',
		'fintech': 'fintech', 'finance': 'fintech', 'crypto': 'fintech', 'payments': 'fintech',
		'events': 'events', 'event': 'events', 'community': 'events', 'conferences': 'events',
		'edtech': 'learning', 'learning': 'learning', 'education': 'learning', 'elearning': 'learning',
		'wellness': 'wellness', 'health': 'wellness', 'mindfulness': 'wellness',
		'delivery': 'delivery', 'logistics': 'delivery',
		'legal': 'legal', 'relocation': 'relocation', 'industrial': 'industrial',
		'corporate': 'corporate', 'enterprise': 'corporate', 'in-house': 'corporate', 'inhouse': 'corporate', 'b2b': 'corporate', 'internal-comms': 'corporate', 'client-work': 'corporate'
	};

	function answersFromUrl() {
		var q;
		try { q = new URLSearchParams(window.location.search); } catch (e) { return null; }
		var raw = [];
		['for', 'v', 'tag', 'skill', 'role', 'sector', 'industry'].forEach(function (k) {
			// URLSearchParams decodes "+" to a space, so split on whitespace too —
			// that's what makes ?for=design+fintech work as well as the comma form.
			(q.get(k) || '').split(/[,|\s]+/).forEach(function (x) { if (x.trim()) raw.push(x); });
		});
		var found = {};
		raw.forEach(function (word) {
			var v = URL_ALIASES[String(word).trim().toLowerCase().replace(/[_\s]+/g, '-')];
			if (!v) return;
			var dim = SKILL_VALS.indexOf(v) !== -1 ? 'skill'
				: (SECTOR_VALS.indexOf(v) !== -1 ? 'sector' : null);
			if (dim && !found[dim]) found[dim] = { val: v, label: labelForVal(dim, v) };
		});
		return Object.keys(found).length ? found : null;
	}

	/* ---------- Skill-specific resumes (PDF + on-page) ----------
	   ?skill=design   → Resume_Product_cbolorinos.pdf
	   ?skill=research → Resume_UX_cbolorinos.pdf
	   ?skill=creative → Resume_Branding_cbolorinos.pdf
	   ?skill=corporate → Resume.pdf (Resume button only; the corporate curated
	                      view still comes from SECTOR_VIEWS, since URL words
	                      resolve by value, not by parameter name)
	   A link with one of these skills gets two things: the Resume button hands
	   over that PDF, and the on-page Experience section shows exactly the bullets
	   in that PDF, in the PDF's order (RESUME_VIEWS, keyed by data-bullet id).
	   Only the URL triggers this. Values go through URL_ALIASES, so ?skill=ux or
	   ?for=branding resolve the same way. Anything else keeps the default PDF and
	   the normal tag-based bullets.

	   KEEP IN SYNC: when a skill PDF changes, update its RESUME_VIEWS list AND the
	   matching skill tag in data-bullet-tags (a bullet carries 'design' /
	   'research' / 'creative' exactly when it appears in that PDF). */
	var RESUME_PDFS = {
		design: 'Resume_Product_cbolorinos.pdf',
		research: 'Resume_UX_cbolorinos.pdf',
		creative: 'Resume_Branding_cbolorinos.pdf',
		corporate: 'Resume.pdf'   // ?skill=corporate — download only; no RESUME_VIEWS entry, so on-page bullets use the normal rules
	};
	var RESUME_VIEWS = {
		design: ['wsa-3', 'wsa-0', 'wsa-2', 'wsa-5', 'fivemins-1', 'fivemins-2', 'swissborg-1', 'swissborg-3', 'ria-3', 'ria-4', 'saturno-3', 'saturno-2', 'saturno-6', 'ventures-kremsegg', 'ventures-hilti'],
		research: ['wsa-5', 'wsa-0', 'wsa-2', 'fivemins-1', 'fivemins-2', 'swissborg-1', 'swissborg-3', 'ria-3', 'ria-4', 'saturno-2', 'saturno-6', 'ventures-hilti', 'ventures-serviceclub-research'],
		creative: ['wsa-1', 'wsa-0', 'wsa-4', 'fivemins-1', 'fivemins-2', 'swissborg-2', 'swissborg-3', 'ria-1', 'ria-2', 'ria-3', 'ria-4', 'saturno-1', 'saturno-2', 'saturno-5', 'ventures-serviceclub-growth', 'ventures-websites']
	};
	// The PDF-backed skill named in the URL, or null.
	function urlResumeSkill() {
		var q;
		try { q = new URLSearchParams(window.location.search); } catch (e) { return null; }
		var words = [];
		['skill', 'for'].forEach(function (k) {
			(q.get(k) || '').split(/[,|\s]+/).forEach(function (x) { if (x.trim()) words.push(x); });
		});
		for (var i = 0; i < words.length; i++) {
			var v = URL_ALIASES[String(words[i]).trim().toLowerCase().replace(/[_\s]+/g, '-')];
			if (v && RESUME_PDFS[v]) return v;
		}
		return null;
	}
	function setResumeLink() {
		var key = urlResumeSkill();
		if (!key) return;
		var links = document.querySelectorAll('a[href="resume_cbolorinos.pdf"]');
		for (var i = 0; i < links.length; i++) links[i].setAttribute('href', RESUME_PDFS[key]);
	}
	// Show exactly the view's bullets, in its order; hide the rest.
	function applyResumeView(timeline, ids) {
		timeline.querySelectorAll('.tl[data-entry] ul').forEach(function (ul) {
			var lis = Array.prototype.slice.call(ul.querySelectorAll('li[data-bullet]'));
			var byId = {};
			lis.forEach(function (li) { byId[li.getAttribute('data-bullet')] = li; });
			ids.forEach(function (id) {
				if (byId[id]) { byId[id].classList.remove('bullet-hidden'); ul.appendChild(byId[id]); delete byId[id]; }
			});
			Object.keys(byId).forEach(function (id) { byId[id].classList.add('bullet-hidden'); ul.appendChild(byId[id]); });
		});
	}

	/* ---------- State ---------- */
	var answers = {};        // { skill:{val,label}, sector:{val,label} }
	var step = 0;
	var snap = {};           // original DOM order snapshots
	var usedFreeText = false; // did this run go through "Other" at any point?
	// "For you" / "Most relevant to you" markers (pills + gold outlines) appear only
	// when the visitor chose a custom view via the Personalize view button. Deep
	// links (?skill=…) tailor the page silently, with no markers.
	var showMarkers = false;

	/* ---------- DOM refs (resolved on init) ---------- */
	var ob, obBody, obOptions, obProgress, obSkip;
	var banner, bannerMsg, fab;

	function el(id) { return document.getElementById(id); }

	/* ---------- Onboarding flow ---------- */
	function openOnboarding() {
		step = 0; answers = {}; usedFreeText = false;
		obBody.innerHTML = ''; obOptions.innerHTML = '';
		ob.classList.add('is-open');
		ob.setAttribute('aria-hidden', 'false');
		document.body.style.overflow = 'hidden';
		renderStep();
	}
	function closeOnboarding() {
		ob.classList.remove('is-open');
		ob.setAttribute('aria-hidden', 'true');
		document.body.style.overflow = '';
	}

	function addMsg(text, role) {
		var d = document.createElement('div');
		d.className = 'ob-msg ' + role + ' enter';
		d.textContent = text;
		obBody.appendChild(d);
		obBody.scrollTop = obBody.scrollHeight;
		return d;
	}

	function renderStep() {
		var q = QUESTIONS[step];
		obProgress.style.width = (step / QUESTIONS.length * 100) + '%';
		obOptions.innerHTML = '';
		addMsg(q.text, 'bot');
		setTimeout(function () {
			var shown = 0;
			q.options.forEach(function (opt) {
				if (opt.hidden) { return; }        // reachable only via "Other" / reconcile
				var key = String.fromCharCode(65 + shown);   // A, B, C… always sequential
				shown++;
				var b = document.createElement('button');
				b.className = 'ob-opt';
				b.innerHTML = '<span class="k">' + key + '</span><span>' + opt.label + '</span>';
				b.addEventListener('click', function () {
					if (opt.val === 'other') { showOther(q); }
					else { choose(q, opt.label, opt.val); }
				});
				obOptions.appendChild(b);
			});
			if (q.skippable) {
				var s = document.createElement('button');
				s.className = 'ob-opt ob-opt--pass';
				s.innerHTML = '<span class="k">&rarr;</span><span>' + (q.skipLabel || 'Skip this question') + '</span>';
				s.addEventListener('click', function () { passQuestion(q); });
				obOptions.appendChild(s);
			}
		}, 260);
	}

	function showOther(q) {
		obOptions.innerHTML = '';
		var wrap = document.createElement('div');
		wrap.className = 'ob-other';
		var input = document.createElement('input');
		input.type = 'text';
		input.placeholder = q.id === 'skill' ? 'e.g. AI & automation, motion graphics, UX research…' : 'e.g. Crypto, education, travel…';
		var send = document.createElement('button');
		send.textContent = 'Send';
		function submit() {
			var v = input.value.trim();
			if (!v) { input.focus(); return; }
			reconcile(q, v);
		}
		send.addEventListener('click', submit);
		input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
		wrap.appendChild(input); wrap.appendChild(send);
		obOptions.appendChild(wrap);
		input.focus();
	}

	// A free-text "Other" answer → ask Claude to steer toward Christian's real areas
	// A free-text answer that lands squarely on one of the hidden categories —
	// "UX Research", "AI & Automation", "wellness" — needs no negotiating. The
	// suggestion screen exists to steer vague answers toward Christian's real
	// areas; when the answer already IS one of those areas, showing it just adds
	// a click and a "Thinking…" pause before the obvious outcome.
	function directHit(q, text) {
		var probe = { val: 'other', custom: text };
		var key = q.id === 'skill'
			? resolveKey(probe, SKILL_SYN, SKILL_WORD_SYN)
			: resolveKey(probe, SECTOR_SYN);
		if (!key) return null;
		var opts = q.options;
		for (var i = 0; i < opts.length; i++) {
			// Only shortcut the hidden ones. A visible category was a button the
			// visitor chose to bypass, so respect that and let the AI weigh in.
			if (opts[i].val === key && opts[i].hidden) return opts[i];
		}
		return null;
	}

	function reconcile(q, text) {
		addMsg(text, 'user');
		obOptions.innerHTML = '';
		usedFreeText = true;   // earns the summary screen at the end

		var hit = directHit(q, text);
		if (hit) {
			finalize(q, hit.label, hit.val, text);
			return;
		}

		var typing = addMsg('Thinking…', 'ob-msg-typing bot');
		var net = fetch(RECONCILE_WEBHOOK, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ type: q.id, text: text })
		}).then(function (r) { return r.json(); });
		var timeout = new Promise(function (_, reject) { setTimeout(function () { reject(new Error('timeout')); }, 15000); });
		Promise.race([net, timeout]).then(function (data) {
			typing.remove();
			var msg = data && data.message;
			var matched = !!(data && data.matched);
			var val = (data && data.val) || '';
			var sugg = (data && Array.isArray(data.suggestions)) ? data.suggestions : [];
			var proj = (data && Array.isArray(data.projects)) ? data.projects : [];
			var extra = {
				dimension: (data && data.dimension) || q.id,
				skillVal: (data && data.skillVal) || '',
				sectorVal: (data && data.sectorVal) || ''
			};
			if (!msg && !sugg.length && !matched) { throw new Error('empty'); }
			if (msg) { addMsg(msg, 'bot'); }
			renderSuggestions(q, text, sugg, matched, val, proj, extra);
		}).catch(function () {
			// Never go silent: acknowledge the answer even when the AI check
			// fails, times out, or returns nothing useful.
			typing.remove();
			addMsg('Thanks — I couldn’t cross-check “' + text + '” against Christian’s work just now, but I’ll tailor the page around it as best I can.', 'bot');
			setTimeout(function () { finalize(q, text, 'other', text); }, 1100);
		});
	}

	function labelForVal(qid, val) {
		for (var i = 0; i < QUESTIONS.length; i++) {
			if (QUESTIONS[i].id !== qid) continue;
			for (var j = 0; j < QUESTIONS[i].options.length; j++) {
				if (QUESTIONS[i].options[j].val === val) return QUESTIONS[i].options[j].label;
			}
		}
		return val;
	}

	function renderSuggestions(q, text, sugg, matched, val, proj, extra) {
		obOptions.innerHTML = '';
		extra = extra || {};
		var allowed = q.id === 'skill' ? SKILL_VALS : SECTOR_VALS;

		// Cross-dimension answer: the visitor answered the skill question with a
		// sector term (or vice versa). Capture it for the OTHER question so we
		// don't stupidly ask again, and answer THIS question with the AI's
		// closest canonical mapping.
		var otherId = q.id === 'skill' ? 'sector' : 'skill';
		var otherVal = otherId === 'skill' ? extra.skillVal : extra.sectorVal;
		var otherAllowed = otherId === 'skill' ? SKILL_VALS : SECTOR_VALS;
		var cross = (extra.dimension === otherId || extra.dimension === 'both') &&
			otherVal && otherAllowed.indexOf(otherVal) !== -1 && !answers[otherId];

		function presetOther() {
			if (!cross) return;
			answers[otherId] = { val: otherVal, label: text, custom: text, aiProjects: (proj && proj.length) ? proj : null };
			addMsg('Since “' + text + '” is really a ' + otherId + ', I’ll use it for that — no need to ask you twice.', 'bot');
		}

		// When Christian has (even vaguely) relevant experience, keeping the
		// visitor's own word is the primary action — the resume tailors to it directly.
		if (matched) {
			var sameVal = q.id === 'skill' ? extra.skillVal : extra.sectorVal;
			var keepVal = (sameVal && allowed.indexOf(sameVal) !== -1) ? sameVal :
				((val && allowed.indexOf(val) !== -1) ? val : 'other');
			// If their term belongs to the other dimension, this question still needs
			// a canonical answer — use the AI's closest mapping and its proper label.
			var keepLabel = (cross && keepVal !== 'other') ? labelForVal(q.id, keepVal) : text;
			var primary = document.createElement('button');
			primary.className = 'ob-opt ob-opt--primary';
			primary.innerHTML = '<span class="k">&#10003;</span><span>Continue with &ldquo;' + escapeHtml(text) + '&rdquo;</span>';
			primary.addEventListener('click', function () {
				addMsg(text, 'user');
				presetOther();
				finalize(q, keepLabel, keepVal, text, proj);
			});
			obOptions.appendChild(primary);
		}

		sugg.forEach(function (s) {
			if (!s || !s.label) { return; }
			var label = capFirst(String(s.label));
			var sval = (s.val && allowed.indexOf(s.val) !== -1) ? s.val : null;
			// A suggestion that belongs to the OTHER dimension (e.g. "Fintech"
			// offered on the skill question) answers that question instead.
			var crossSug = !sval && s.val && otherAllowed.indexOf(s.val) !== -1 && !answers[otherId];
			var b = document.createElement('button');
			b.className = 'ob-opt';
			b.innerHTML = '<span class="k">&rsaquo;</span><span>' + escapeHtml(label) + '</span>';
			b.addEventListener('click', function () {
				addMsg(label, 'user');
				if (crossSug) {
					answers[otherId] = { val: s.val, label: label, custom: null, aiProjects: (proj && proj.length) ? proj : null };
					var sameVal = q.id === 'skill' ? extra.skillVal : extra.sectorVal;
					if (sameVal && allowed.indexOf(sameVal) !== -1) {
						finalize(q, labelForVal(q.id, sameVal), sameVal, text, proj);
					} else {
						finalize(q, text, 'other', text, proj);
					}
					return;
				}
				presetOther();
				finalize(q, label, sval || 'other', sval ? null : label, proj);
			});
			obOptions.appendChild(b);
		});

		if (!matched) {
			var keep = document.createElement('button');
			keep.className = 'ob-opt ob-opt--keep';
			keep.innerHTML = '<span class="k">&#9998;</span><span>Use &ldquo;' + escapeHtml(text) + '&rdquo; anyway</span>';
			keep.addEventListener('click', function () {
				addMsg(text, 'user');
				presetOther();
				finalize(q, text, 'other', text, proj);
			});
			obOptions.appendChild(keep);
		}
	}

	function choose(q, label, val, custom, aiProjects) {
		addMsg(label, 'user');
		finalize(q, label, val, custom, aiProjects);
	}

	function finalize(q, label, val, custom, aiProjects) {
		answers[q.id] = { val: val, label: label, custom: custom || null, aiProjects: (aiProjects && aiProjects.length) ? aiProjects : null };
		advance();
	}

	// "No preference" on a skippable question. The dimension is deliberately left
	// out of `answers` rather than stored as a sentinel — resolveKey, score(),
	// setAboutCopy and filterResume all already branch on a falsy key, so an
	// absent answer needs no special-casing anywhere downstream.
	function passQuestion(q) {
		addMsg('No preference', 'user');
		delete answers[q.id];
		advance();
	}

	function advance() {
		obOptions.innerHTML = '';
		step++;
		// Skip any question that was already answered (e.g. pre-filled because the
		// visitor's free-text answer belonged to the other dimension).
		while (step < QUESTIONS.length && answers[QUESTIONS[step].id]) { step++; }
		if (step < QUESTIONS.length) { setTimeout(renderStep, 380); return; }
		finish();
	}

	function apply() {
		showMarkers = true;
		closeOnboarding();
		applyPersonalization();
		persist();
	}

	function finish() {
		// Nothing to personalize (every question passed) — don't promise a tailored
		// page and then deliver the default one.
		if (!answers.skill && !answers.sector) { skip(); return; }

		obProgress.style.width = '100%';
		// Preset buttons need no summary — the visitor just read the labels they
		// clicked, so restating them is a click that tells them nothing. Free text
		// is different: it went through reconcile and may have landed on a category
		// they didn't literally type, which is worth showing before the page moves.
		if (!usedFreeText) {
			setTimeout(apply, 420);   // let the last answer land before the overlay drops
			return;
		}

		var sLab = answers.skill ? answers.skill.label : '';
		var secLab = answers.sector ? answers.sector.label : '';
		var focus;
		if (sLab && secLab) { focus = 'Christian’s ' + sLab + ' work in ' + secLab; }
		else if (sLab) { focus = 'Christian’s ' + sLab + ' work across every sector'; }
		else { focus = 'Christian’s work in ' + secLab; }
		addMsg('Perfect — I’ll bring ' + focus +
			' to the front: the most relevant projects, resume highlights and skills will appear first, and everything else stays right below.', 'bot');
		var done = document.createElement('button');
		done.className = 'ob-opt ob-opt--primary';
		done.innerHTML = '<span class="k">&#10003;</span><span>Okay &mdash; show me</span>';
		done.addEventListener('click', apply);
		obOptions.appendChild(done);
	}

	function skip() {
		closeOnboarding();
		reset();                          // ensure default layout
		store.setItem(STORE_KEY, JSON.stringify({ skipped: true }));
		showFab();
	}

	/* ---------- Persistence ---------- */
	function persist() {
		store.setItem(STORE_KEY, JSON.stringify({ answers: answers, markers: showMarkers }));
	}

	/* ---------- Helpers ---------- */
	function resolveKey(ans, synMap, wordMap) {
		if (!ans) return null;
		if (ans.val !== 'other') return ans.val;
		var t = (ans.custom || '').toLowerCase();
		// Longest matching synonym wins, not whichever key happens to come first.
		// "ux research" contains both 'ux' (design) and 'ux research' (research);
		// first-key-wins would call it Product Design, which is just wrong.
		var best = null, bestLen = 0;
		for (var key in synMap) {
			if (!synMap.hasOwnProperty(key)) continue;
			for (var i = 0; i < synMap[key].length; i++) {
				var syn = synMap[key][i];
				if (syn.length > bestLen && t.indexOf(syn) !== -1) { best = key; bestLen = syn.length; }
			}
		}
		if (best) return best;
		// Whole-word pass for short tokens that would false-positive as substrings
		var words = t.split(/[^a-z0-9]+/);
		for (var wkey in (wordMap || {})) {
			if (!wordMap.hasOwnProperty(wkey)) continue;
			for (var j = 0; j < wordMap[wkey].length; j++) {
				if (words.indexOf(wordMap[wkey][j]) !== -1) return wkey;
			}
		}
		return null; // unresolved custom -> fall back to text matching
	}
	function has(arr, v) { return v && arr && arr.indexOf(v) !== -1; }

	/* ---------- Snapshot original order once ---------- */
	function takeSnapshot() {
		var grid = document.getElementById('grid');
		snap.grid = grid ? { parent: grid, kids: Array.prototype.slice.call(grid.children) } : null;
		var expTimeline = document.querySelector('.resume .timeline');
		snap.exp = expTimeline ? { parent: expTimeline, kids: Array.prototype.slice.call(expTimeline.children) } : null;
		snap.bullets = [];
		if (expTimeline) expTimeline.querySelectorAll('.tl[data-entry] ul').forEach(function (ul) {
			snap.bullets.push({ parent: ul, kids: Array.prototype.slice.call(ul.children) });
		});
		snap.cols = [];
		document.querySelectorAll('.skills__col').forEach(function (col) {
			snap.cols.push({ parent: col, kids: Array.prototype.slice.call(col.children) });
		});
		// Default About copy, so "Reset to default view" can put it back verbatim
		snap.about = {
			bio: aboutCopyOf(el('aboutBio')),
			whatIDo: aboutCopyOf(el('aboutWhatIDo')),
			close: aboutCopyOf(el('aboutClose'))
		};
	}

	/* ---------- About Me copy swap ----------
	   main.js runs first and turns these paragraphs into a scroll-driven
	   typewriter, replacing their contents with <span class="tw-typed"> +
	   <span class="tw-rest">. So we must never read or write innerHTML naively
	   here: reading would capture that span markup, and writing would detach the
	   spans main.js is still animating — which left the paragraphs stuck at
	   opacity:0 (.typewriter .tw-rest) and the About section looking blank. */
	function aboutCopyOf(elm) {
		if (!elm) return null;
		var t = elm.querySelector('.tw-typed'), r = elm.querySelector('.tw-rest');
		if (t || r) { return (t ? t.textContent : '') + (r ? r.textContent : ''); }
		return elm.textContent;
	}

	function writeAboutCopy(elm, text) {
		if (!elm || text == null) return;
		elm.textContent = text;   // entities in the variants are already decoded
	}

	function afterAboutCopyChange() {
		// Let the typewriter re-read the new text (no-op if it never initialised,
		// e.g. prefers-reduced-motion, in which case textContent is enough).
		if (typeof window.cbAboutTypewriterRefresh === 'function') {
			window.cbAboutTypewriterRefresh();
		}
	}

	function setAboutCopy(skillKey, sectorKey) {
		if (!el('aboutBio') && !el('aboutWhatIDo') && !el('aboutClose')) return;
		// An unresolved / unprepared skill falls back to the default copy
		var v = ABOUT_VARIANTS[skillKey] || ABOUT_VARIANTS.dflt;
		var bio = decodeEntities(v.bio);
		// The sector sentence belongs on the end of the bio paragraph, and only
		// the three prepared sectors get one.
		var sectorLine = ABOUT_SECTOR_LINES[sectorKey];
		if (sectorLine) { bio += ' ' + decodeEntities(sectorLine); }
		writeAboutCopy(el('aboutBio'), bio);
		writeAboutCopy(el('aboutWhatIDo'), decodeEntities(v.whatIDo));
		writeAboutCopy(el('aboutClose'), decodeEntities(v.close));
		afterAboutCopyChange();
	}

	function resetAboutCopy() {
		if (!snap.about) return;
		writeAboutCopy(el('aboutBio'), snap.about.bio);
		writeAboutCopy(el('aboutWhatIDo'), snap.about.whatIDo);
		writeAboutCopy(el('aboutClose'), snap.about.close);
		afterAboutCopyChange();
	}

	var entityScratch = null;
	function decodeEntities(s) {
		if (s == null || s.indexOf('&') === -1) return s;
		if (!entityScratch) { entityScratch = document.createElement('textarea'); }
		entityScratch.innerHTML = s;
		return entityScratch.value;
	}

	/* ---------- Reset to default ---------- */
	function reset() {
		// restore order
		if (snap.grid) snap.grid.kids.forEach(function (k) { snap.grid.parent.appendChild(k); });
		if (snap.exp) snap.exp.kids.forEach(function (k) { snap.exp.parent.appendChild(k); });
		snap.cols.forEach(function (c) { c.kids.forEach(function (k) { c.parent.appendChild(k); }); });
		(snap.bullets || []).forEach(function (c) { c.kids.forEach(function (k) { c.parent.appendChild(k); }); });
		// strip markers
		document.querySelectorAll('.is-relevant').forEach(function (n) { n.classList.remove('is-relevant'); });
		document.querySelectorAll('.card__pill, .tl__pill, .skills__pill').forEach(function (n) { n.remove(); });
		// back to the Default-tagged bullets only — the un-personalized resume
		document.querySelectorAll('li.bullet-hidden').forEach(function (n) { n.classList.remove('bullet-hidden'); });
		showDefaultBullets();
		// re-hide conditional cards (default view never shows them)
		document.querySelectorAll('.card--conditional').forEach(function (c) { c.classList.remove('is-revealed'); c.classList.add('is-hidden'); });
		// undo any curated-view suppression
		document.querySelectorAll('.card--suppressed').forEach(function (c) { c.classList.remove('card--suppressed'); });
		resetAboutCopy();
		setResumeLoading(false);
		if (banner) banner.classList.remove('is-on');
	}

	/* ---------- Apply personalization ---------- */
	var STAR = '<svg viewBox="0 0 24 24"><path d="M12 2l2.4 6.5L21 9l-5 4 1.7 7-5.7-3.7L6.3 20 8 13 3 9l6.6-.5z"/></svg>';

	function applyPersonalization() {
		reset(); // clean slate before applying

		var skillKey = resolveKey(answers.skill, SKILL_SYN, SKILL_WORD_SYN);
		var sectorKey = resolveKey(answers.sector, SECTOR_SYN);
		var skillText = answers.skill ? (answers.skill.custom || answers.skill.label).toLowerCase() : '';
		var sectorText = answers.sector ? (answers.sector.custom || answers.sector.label).toLowerCase() : '';

		// Curated views for this skill and sector, if any. Suppression/feature is the
		// union of both — see the SECTOR_VIEWS / SKILL_VIEWS comment above.
		var view = SECTOR_VIEWS[sectorKey] || null;
		var skillView = SKILL_VIEWS[skillKey] || null;
		function inView(list, key) {
			if (!key) return false;
			if (view && view[list] && view[list].indexOf(key) !== -1) return true;
			if (skillView && skillView[list] && skillView[list].indexOf(key) !== -1) return true;
			return false;
		}

		// AI relevance ranking: Claude reads the resume + case studies and returns
		// project keys ranked by fit to the visitor's free-text answer. Rank 0 gets
		// the biggest boost, so AI ordering outweighs the coarse tag scores below.
		var aiRank = {};
		['skill', 'sector'].forEach(function (qid) {
			var a = answers[qid];
			var list = a && a.aiProjects;
			if (!list) return;
			list.forEach(function (key, i) {
				var boost = 12 - i * 2;
				if (boost > 0) aiRank[key] = Math.max(aiRank[key] || 0, boost);
			});
		});

		// Reveal each conditional card based on its own data-reveal-* rules
		function listAttr(elm, name) {
			return (elm.getAttribute(name) || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
		}
		function mentionsAny(list, t) {
			if (!t || !list) return false;
			for (var i = 0; i < list.length; i++) { if (t.indexOf(list[i]) !== -1) return true; }
			return false;
		}
		document.querySelectorAll('.card--conditional').forEach(function (c) {
			var rSkill = listAttr(c, 'data-reveal-skill');
			var rSector = listAttr(c, 'data-reveal-sector');
			var kwSet = KW_SETS[c.getAttribute('data-reveal-kw')] || [];
			var reveal = (skillKey && rSkill.indexOf(skillKey) !== -1) ||
				(sectorKey && rSector.indexOf(sectorKey) !== -1) ||
				!!aiRank[c.getAttribute('data-modal')] ||
				inView('feature', c.getAttribute('data-modal')) ||
				mentionsAny(kwSet, skillText) || mentionsAny(kwSet, sectorText);
			c.classList.toggle('is-revealed', reveal);   // is-revealed = revealed by the visitor's interests
			c.classList.toggle('is-hidden', !reveal);
		});

		function score(tags, title) {
			var s = 0;
			if (has(tags.skills, skillKey)) s += 2;
			if (tags.sectors && has(tags.sectors, sectorKey)) s += 3;
			// unresolved custom → try matching their raw words against the title
			var t = (title || '').toLowerCase();
			if (!skillKey && skillText && t.indexOf(skillText) !== -1) s += 1;
			if (!sectorKey && sectorText && t.indexOf(sectorText) !== -1) s += 1;
			return s;
		}

		// ----- Portfolio -----
		var grid = document.getElementById('grid');
		if (grid) {
			var cards = Array.prototype.slice.call(grid.querySelectorAll('.card'));
			// Suppression first: a suppressed card is off the page, so it should never
			// pick up an ordering position or a "For you" pill.
			cards.forEach(function (c) {
				c.classList.toggle('card--suppressed', inView('suppress', c.getAttribute('data-modal')));
			});
			var scored = cards.map(function (c, i) {
				var key = c.getAttribute('data-modal');
				var tags = PROJECT_TAGS[key] || { skills: [], sectors: [] };
				var title = (c.querySelector('h3') || {}).textContent || '';
				var sc = score(tags, title) + (aiRank[key] || 0);
				if (inView('feature', key)) { sc += FEATURE_BOOST; }
				if (inView('suppress', key)) { sc = -1; }
				return { el: c, sc: sc, i: i };
			});
			scored.sort(function (a, b) { return b.sc - a.sc || a.i - b.i; });
			scored.forEach(function (o) {
				grid.appendChild(o.el);
				if (o.sc > 0 && showMarkers) {
					o.el.classList.add('is-relevant');
					if (!o.el.querySelector('.card__pill')) {
						var pill = document.createElement('span');
						pill.className = 'card__pill';
						pill.innerHTML = STAR + 'For you';
						var media = o.el.querySelector('.card__media') || o.el;
						media.appendChild(pill);
					}
				}
			});
		}

		// ----- Resume (experience) -----
		var exp = document.querySelector('.resume .timeline');
		if (exp) {
			var items = Array.prototype.slice.call(exp.querySelectorAll('.tl'));
			var scoredR = items.map(function (it, i) {
				var h = (it.querySelector('h4') || {}).textContent || '';
				var tag = null;
				for (var j = 0; j < RESUME_TAGS.length; j++) {
					if (h.indexOf(RESUME_TAGS[j].match) !== -1) { tag = RESUME_TAGS[j]; break; }
				}
				var tags = tag || { skills: [], sectors: [] };
				return { el: it, sc: score(tags, h), i: i };
			});
			// Roles stay in reverse-chronological order, always. A resume that
			// reshuffles its jobs reads as a broken timeline, and the bullets under
			// each role are already filtered to the visitor — no "Relevant to you"
			// pill either. The gold panel outline is the only marker.
			scoredR.forEach(function (o) {
				if (o.sc > 0 && showMarkers) { o.el.classList.add('is-relevant'); }
			});
		}

		// ----- Skills -----
		document.querySelectorAll('.skills__col').forEach(function (col) {
			var its = Array.prototype.slice.call(col.querySelectorAll('.skills__item'));
			var scoredS = its.map(function (it, i) {
				var h = (it.querySelector('h4') || {}).textContent || '';
				var tag = null;
				for (var j = 0; j < SKILL_ITEM_TAGS.length; j++) {
					if (h.indexOf(SKILL_ITEM_TAGS[j].match) !== -1) { tag = SKILL_ITEM_TAGS[j]; break; }
				}
				var rel = tag && skillKey && has(tag.skills, skillKey);
				return { el: it, rel: rel, i: i };
			});
			scoredS.sort(function (a, b) { return (b.rel ? 1 : 0) - (a.rel ? 1 : 0) || a.i - b.i; });
			scoredS.forEach(function (o) {
				col.appendChild(o.el);
				if (o.rel && showMarkers) {
					o.el.classList.add('is-relevant');
					if (!o.el.querySelector('.skills__pill')) {
						var pill = document.createElement('span');
						pill.className = 'skills__pill';
						pill.textContent = '★ Most relevant to you';
						o.el.insertBefore(pill, o.el.firstChild);
					}
				}
			});
		});

		// ----- About copy + banner -----
		setAboutCopy(skillKey, sectorKey);
		setBanner();
		showFab();

		// ----- AI-filter the resume bullets -----
		filterResume();
	}

	/* ---------- Resume bullet filtering (live n8n + Claude, local fallback) ---------- */
	var KW = {
		design: ['design', 'ui', 'ux', 'interface', 'wireframe', 'prototyp', 'illustrat', 'visual', 'component', 'micro-anim', 'high-fidelity', 'user flow', 'brand guideline', 'design system'],
		strategy: ['strateg', 'a/b', 'experiment', 'conversion', 'retention', 'funnel', 'growth', 'optimiz', 'analytic', 'kpi', 'segment', 'acquisition', 'data'],
		research: ['research', 'interview', 'discovery', 'usability', 'survey', 'synthesis', 'insight', 'user testing', 'pain point', 'demographic', 'analysed', 'analyzed'],
		creative: ['brand', 'creative', 'campaign', 'storytell', 'social media', 'motion', 'video', 'generative ai', 'narrative', 'employer brand', 'illustrat'],
		fintech: ['swissborg', 'ria', 'fintech', 'financ', 'money', 'remittance', 'crypto', 'nft', 'cborg', 'acquisition'],
		events: ['wsa', 'summit', 'festival', 'event', 'community', 'network', 'newsletter'],
		wellness: ['gomde', 'retreat', 'wellbeing', 'mindful', 'buddhis', 'health', 'medita'],
		learning: ['learning', 'elearning', 'e-learning', 'course', 'coursera', 'academy', 'educational', 'education', 'quiz', 'certificate', 'badge', 'upskill', 'universit', 'student', 'gamification', 'ie business school', 'macroeconomics', 'curricul', 'teach', 'training', '5mins'],
		automation: ['automat', 'n8n', 'agentic', 'workflow', 'chatbot', 'generative ai', 'ai agent', 'ai-generated', 'gpt', 'llm', 'claude', 'zapier', 'pipeline']
	};

	function collectEntries(timeline) {
		var out = [];
		timeline.querySelectorAll('.tl[data-entry]').forEach(function (tl) {
			var bullets = [];
			tl.querySelectorAll('li[data-bullet]').forEach(function (li) {
				bullets.push({
					id: li.getAttribute('data-bullet'),
					text: li.textContent.trim(),
					// Explicit audience tags. Some bullets are highly relevant to a
					// visitor without containing any of that category's keywords —
					// "quiz chatbot for IE's Macroeconomics course" is a design and
					// strategy story, but says neither word. Tags pin those in place
					// regardless of how the keyword or Claude scoring lands.
					tags: (li.getAttribute('data-bullet-tags') || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean),
					el: li
				});
			});
			var h = tl.querySelector('h4');
			out.push({ id: tl.getAttribute('data-entry'), title: h ? h.textContent.trim() : '', bullets: bullets });
		});
		return out;
	}

	function localScores(entries, skillKey, sectorKey, skillText, sectorText) {
		var scores = {};
		var skillWords = (KW[skillKey] || []).concat(skillText ? [skillText] : []);
		var sectorWords = (KW[sectorKey] || []).concat(sectorText ? [sectorText] : []);
		entries.forEach(function (e) {
			e.bullets.forEach(function (b) {
				var t = b.text.toLowerCase();
				var s = 45; // neutral baseline
				skillWords.forEach(function (w) { if (w && t.indexOf(w) !== -1) s += 16; });
				sectorWords.forEach(function (w) { if (w && t.indexOf(w) !== -1) s += 14; });
				scores[b.id] = Math.min(100, s);
			});
		});
		return scores;
	}

	/* ---------- Tag-driven bullet visibility ----------
	   Every bullet carries an explicit `data-bullet-tags` list. Tags decide
	   visibility outright; the AI scoring below only ever sees bullets that were
	   left untagged. The rule:

	     "default"                → always visible, including before onboarding
	     matches the chosen skill → visible once personalized
	     matches the chosen sector→ visible once personalized
	     no tags at all           → handed to the scorer

	   Returns the entries that still contain undecided (untagged) bullets. */
	function applyTagRules(entries, skillKey, sectorKey, personalized) {
		var undecided = [];
		entries.forEach(function (e) {
			var pending = [], shown = 0, firstEl = null;
			e.bullets.forEach(function (b) {
				if (!firstEl) firstEl = b.el;
				if (!b.tags || !b.tags.length) { pending.push(b); return; }
				var vis = b.tags.indexOf('default') !== -1 ||
					(personalized && skillKey && b.tags.indexOf(skillKey) !== -1) ||
					(personalized && sectorKey && b.tags.indexOf(sectorKey) !== -1);
				b.el.classList.toggle('bullet-hidden', !vis);
				if (vis) shown++;
			});
			// A role should never render as a bare heading with nothing under it.
			if (!shown && !pending.length && firstEl) firstEl.classList.remove('bullet-hidden');
			if (pending.length) undecided.push({ id: e.id, title: e.title, bullets: pending });
		});
		return undecided;
	}

	// Pre-onboarding (and after a reset): only the Default bullets.
	function showDefaultBullets() {
		var timeline = document.querySelector('.resume .timeline');
		if (!timeline) return;
		applyTagRules(collectEntries(timeline), null, null, false);
	}

	// Only ever called with untagged bullets — tagged ones are already resolved.
	function applyScores(entries, scores) {
		entries.forEach(function (e) {
			if (e.bullets.length <= MIN_BULLETS) {
				e.bullets.forEach(function (b) { b.el.classList.remove('bullet-hidden'); });
				return;
			}
			var ranked = e.bullets.slice().sort(function (a, b) {
				return (scores[b.id] != null ? scores[b.id] : 50) - (scores[a.id] != null ? scores[a.id] : 50);
			});
			var keep = {};
			ranked.forEach(function (b) { if ((scores[b.id] != null ? scores[b.id] : 50) >= KEEP_THRESHOLD) keep[b.id] = true; });
			// guarantee the minimum by topping up with the highest-scored remaining
			for (var i = 0; i < ranked.length && Object.keys(keep).length < MIN_BULLETS; i++) { keep[ranked[i].id] = true; }
			e.bullets.forEach(function (b) { b.el.classList.toggle('bullet-hidden', !keep[b.id]); });
		});
	}

	function fetchScores(entries, payload) {
		var controller = { done: false };
		var net = fetch(RESUME_WEBHOOK, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		}).then(function (r) { return r.json(); }).then(function (data) {
			var s = data && (data.scores || data.output || data);
			if (!s || typeof s !== 'object' || Object.keys(s).length === 0) throw new Error('bad payload');
			return s;
		});
		var timeout = new Promise(function (_, reject) {
			setTimeout(function () { reject(new Error('timeout')); }, FETCH_TIMEOUT);
		});
		return Promise.race([net, timeout]);
	}

	function setResumeLoading(on) {
		var section = document.querySelector('.resume');
		if (!section) return;
		section.classList.toggle('is-filtering', !!on);
		var chip = document.getElementById('resumeStatus');
		if (on && !chip) {
			var host = section.querySelector('.resume__subtitle');
			if (host) {
				chip = document.createElement('span');
				chip.id = 'resumeStatus';
				chip.className = 'resume-status';
				chip.innerHTML = '<span class="resume-status__dot"></span> Tailoring to your interests…';
				host.appendChild(chip);
			}
		} else if (!on && chip) {
			chip.remove();
		}
	}

	function filterResume() {
		var timeline = document.querySelector('.resume .timeline');
		if (!timeline) return;
		var entries = collectEntries(timeline);
		if (!entries.length) return;

		var skillKey = resolveKey(answers.skill, SKILL_SYN, SKILL_WORD_SYN);
		var sectorKey = resolveKey(answers.sector, SECTOR_SYN);
		var skillText = answers.skill ? (answers.skill.custom || answers.skill.label).toLowerCase() : '';
		var sectorText = answers.sector ? (answers.sector.custom || answers.sector.label).toLowerCase() : '';
		var roleLabel = answers.skill ? answers.skill.label : '';
		var sectorLabel = answers.sector ? answers.sector.label : '';

		// Tags decide first and are final. Anything they don't cover falls through
		// to the scorer below; when every bullet is tagged this returns nothing and
		// the page never touches the network.
		// A ?skill= link for a PDF-backed skill mirrors that PDF exactly, but only
		// while the visitor's answer is still that skill (re-running the onboarding
		// with a different choice falls back to the normal tag rules).
		var urlSkill = urlResumeSkill();
		if (urlSkill && urlSkill === skillKey) { applyResumeView(timeline, RESUME_VIEWS[urlSkill]); return; }

		entries = applyTagRules(entries, skillKey, sectorKey, true);
		if (!entries.length) return;

		var cacheKey = 'cb-resume:' + roleLabel + '|' + sectorLabel;
		var cached = null;
		try { cached = JSON.parse(store.getItem(cacheKey)); } catch (e) { cached = null; }
		if (cached) { applyScores(entries, cached); return; }

		var local = localScores(entries, skillKey, sectorKey, skillText, sectorText);

		if (!RESUME_WEBHOOK) { applyScores(entries, local); return; }

		var payload = {
			role: roleLabel, sector: sectorLabel,
			roleCustom: answers.skill && answers.skill.custom || null,
			sectorCustom: answers.sector && answers.sector.custom || null,
			entries: entries.map(function (e) {
				return { id: e.id, title: e.title, bullets: e.bullets.map(function (b) { return { id: b.id, text: b.text }; }) };
			})
		};

		setResumeLoading(true);
		fetchScores(entries, payload).then(function (scores) {
			store.setItem(cacheKey, JSON.stringify(scores));
			applyScores(entries, scores);
			setResumeLoading(false);
		}).catch(function () {
			applyScores(entries, local);   // graceful fallback — never leaves the resume broken
			setResumeLoading(false);
		});
	}

	// The "You're exploring X in Y" banner is gone: the tailored page speaks for
	// itself, and announcing the filtering drew attention to it. Kept as a no-op
	// so the call sites stay honest if the banner ever comes back.
	function setBanner() {}
	function escapeHtml(s) {
		return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}
	function capFirst(s) {
		s = String(s);
		return s.charAt(0).toUpperCase() + s.slice(1);
	}

	/* ---------- FAB ---------- */
	function showFab() { if (fab) fab.classList.add('is-on'); }

	function buildFab() {
		fab = document.createElement('button');
		fab.className = 'perso-fab';
		fab.id = 'persoFab';
		fab.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 2l2.4 6.5L21 9l-5 4 1.7 7-5.7-3.7L6.3 20 8 13 3 9l6.6-.5z"/></svg> Personalize view';
		fab.addEventListener('click', openOnboarding);
		document.body.appendChild(fab);
	}

	/* ---------- Init ---------- */
	function init() {
		ob = el('onboarding'); obBody = el('obBody'); obOptions = el('obOptions');
		obProgress = el('obProgress'); obSkip = el('obSkip');
		banner = el('persoBanner'); bannerMsg = el('persoBannerMsg');
		setResumeLink();   // runs even if the onboarding markup is missing
		if (!ob) return;

		takeSnapshot();
		buildFab();
		showDefaultBullets();   // the resume opens on its Default bullets, personalized or not

		obSkip.addEventListener('click', skip);
		var resetBtn = el('persoReset');
		if (resetBtn) resetBtn.addEventListener('click', function () {
			reset();
			store.setItem(STORE_KEY, JSON.stringify({ skipped: true }));
		});
		// close on overlay click = treat as skip
		ob.querySelector('.onboarding__overlay').addEventListener('click', skip);
		document.addEventListener('keydown', function (e) {
			if (e.key === 'Escape' && ob.classList.contains('is-open')) skip();
		});

		// A deep link outranks everything: never interrupt someone who arrived on
		// a URL that already says what they came to see.
		var linked = answersFromUrl();
		if (linked) {
			answers = linked;
			store.setItem(STORE_KEY, JSON.stringify({ answers: answers }));
			applyPersonalization();
			return;
		}

		// Returning within the same session?
		var saved = null;
		try { saved = JSON.parse(store.getItem(STORE_KEY)); } catch (e) { saved = null; }

		if (saved && saved.answers) {
			answers = saved.answers;
			showMarkers = !!saved.markers;
			applyPersonalization();       // apply silently, no overlay
		} else {
			// No automatic onboarding: the chatbot only opens when the visitor clicks
			// "Personalize view" (bottom left).
			showFab();
		}
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
