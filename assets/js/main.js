/* =========================================================
   Christian Bolorinos — Portfolio interactions
   ========================================================= */
(function () {
	'use strict';

	var isTouch = window.matchMedia('(hover: none), (pointer: coarse)').matches;
	var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	/* ---------- Preloader ---------- */
	window.addEventListener('load', function () {
		var pre = document.getElementById('preloader');
		if (pre) { setTimeout(function () { pre.classList.add('is-done'); }, 500); }
	});

	document.addEventListener('DOMContentLoaded', function () {

		/* ---------- Custom cursor ---------- */
		if (!isTouch && !reduceMotion) {
			document.body.classList.add('hide-native');
			var dot = document.getElementById('cursorDot');
			var ring = document.getElementById('cursorRing');
			var mx = window.innerWidth / 2, my = window.innerHeight / 2;
			var rx = mx, ry = my;
			window.addEventListener('mousemove', function (e) {
				mx = e.clientX; my = e.clientY;
				dot.style.transform = 'translate(' + mx + 'px,' + my + 'px) translate(-50%,-50%)';
			});
			(function loop() {
				rx += (mx - rx) * 0.18;
				ry += (my - ry) * 0.18;
				ring.style.transform = 'translate(' + rx + 'px,' + ry + 'px) translate(-50%,-50%)';
				requestAnimationFrame(loop);
			})();
			var hoverSel = 'a, button, .card, .filter__btn, [data-cursor="link"]';
			document.addEventListener('mouseover', function (e) {
				if (e.target.closest(hoverSel)) { dot.classList.add('is-hover'); ring.classList.add('is-hover'); }
			});
			document.addEventListener('mouseout', function (e) {
				if (e.target.closest(hoverSel)) { dot.classList.remove('is-hover'); ring.classList.remove('is-hover'); }
			});
			document.addEventListener('mouseleave', function () { dot.style.opacity = 0; ring.style.opacity = 0; });
			document.addEventListener('mouseenter', function () { dot.style.opacity = 1; ring.style.opacity = 1; });
		}

		/* ---------- Magnetic buttons ---------- */
		if (!isTouch && !reduceMotion) {
			document.querySelectorAll('.magnetic').forEach(function (el) {
				el.addEventListener('mousemove', function (e) {
					var r = el.getBoundingClientRect();
					var x = e.clientX - r.left - r.width / 2;
					var y = e.clientY - r.top - r.height / 2;
					el.style.transform = 'translate(' + x * 0.28 + 'px,' + y * 0.28 + 'px)';
				});
				el.addEventListener('mouseleave', function () { el.style.transform = ''; });
			});
		}

		/* ---------- Navigation ---------- */
		var nav = document.getElementById('nav');
		var navToggle = document.getElementById('navToggle');
		var navMenu = document.getElementById('navMenu');
		var scrollUpBtn = document.getElementById('scrollUp');   // hoisted out of the scroll handler
		function onScroll() {
			var y = window.scrollY;
			nav.classList.toggle('is-scrolled', y > 40);
			if (scrollUpBtn) scrollUpBtn.classList.toggle('is-visible', y > 600);
		}
		window.addEventListener('scroll', onScroll, { passive: true });
		onScroll();

		navToggle.addEventListener('click', function () {
			navToggle.classList.toggle('is-open');
			navMenu.classList.toggle('is-open');
		});
		navMenu.querySelectorAll('a').forEach(function (a) {
			a.addEventListener('click', function () {
				navToggle.classList.remove('is-open');
				navMenu.classList.remove('is-open');
			});
		});

		/* ---------- Scrollspy for nav ---------- */
		var sections = ['home', 'about', 'works', 'resume', 'skills', 'contact']
			.map(function (id) { return document.getElementById(id); }).filter(Boolean);
		var navLinks = navMenu.querySelectorAll('a');
		var spy = new IntersectionObserver(function (entries) {
			entries.forEach(function (en) {
				if (en.isIntersecting) {
					navLinks.forEach(function (l) {
						l.classList.toggle('is-active', l.getAttribute('href') === '#' + en.target.id);
					});
				}
			});
		}, { rootMargin: '-45% 0px -50% 0px' });
		sections.forEach(function (s) { spy.observe(s); });

		/* ---------- Section-title word stagger ---------- */
		(function () {
			var titleObs = new IntersectionObserver(function (entries) {
				entries.forEach(function (en) {
					if (en.isIntersecting) { en.target.classList.add('is-in'); titleObs.unobserve(en.target); }
				});
			}, { threshold: 0.35 });
			document.querySelectorAll('.section-title').forEach(function (t) {
				t.classList.remove('reveal'); // claim it so the generic reveal doesn't double-animate
				if (reduceMotion) { return; }
				var parts = t.textContent.split(/(\s+)/);
				t.textContent = '';
				var wi = 0;
				parts.forEach(function (w) {
					if (/^\s+$/.test(w) || w === '') { t.appendChild(document.createTextNode(w)); return; }
					var span = document.createElement('span');
					span.className = 'tw-word';
					span.textContent = w;
					span.style.transitionDelay = (wi * 0.07) + 's';
					wi++;
					t.appendChild(span);
				});
				titleObs.observe(t);
			});
		})();

		/* ---------- Scroll reveal ---------- */
		var revealObs = new IntersectionObserver(function (entries) {
			entries.forEach(function (en) {
				if (en.isIntersecting) {
					en.target.classList.add('is-in');
					revealObs.unobserve(en.target);
				}
			});
		}, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
		document.querySelectorAll('.reveal').forEach(function (el, i) {
			el.style.transitionDelay = (i % 4) * 0.06 + 's';
			revealObs.observe(el);
		});

		/* ---------- Scroll to top ---------- */
		document.getElementById('scrollUp').addEventListener('click', function () {
			window.scrollTo({ top: 0, behavior: 'smooth' });
		});

		/* ---------- Parallax on background blobs ---------- */
		if (!reduceMotion) {
			var svg = document.querySelector('.bg-svg');
			window.addEventListener('scroll', function () {
				if (svg) svg.style.transform = 'translateY(' + window.scrollY * 0.06 + 'px)';
			}, { passive: true });
		}

		/* ---------- Scroll-driven typewriter (About) ---------- */
		var twUpdate = null;
		(function () {
			var anchor = document.querySelector('.about__text');
			var paras = document.querySelectorAll('#about .about__block p');
			if (!anchor || !paras.length || reduceMotion) { return; }
			var items = [], total = 0;

			// personalize.js rewrites this copy at runtime, which blows away the
			// spans below. build() is therefore re-runnable: it reads the real text
			// back out of any spans it already created instead of re-wrapping them.
			function build() {
				items = []; total = 0;
				paras.forEach(function (p) {
					p.classList.add('typewriter');
					var t0 = p.querySelector('.tw-typed'), r0 = p.querySelector('.tw-rest');
					var full = (t0 || r0)
						? ((t0 ? t0.textContent : '') + (r0 ? r0.textContent : ''))
						: p.textContent;
					p.textContent = '';
					var typed = document.createElement('span'); typed.className = 'tw-typed';
					var rest = document.createElement('span'); rest.className = 'tw-rest'; rest.textContent = full;
					p.appendChild(typed); p.appendChild(rest);
					items.push({ el: p, full: full, len: full.length, typed: typed, rest: rest, n: -1 });
					total += full.length;
				});
			}
			build();

			// Cached so the per-frame path never has to touch window.innerHeight
			var vh = window.innerHeight || document.documentElement.clientHeight;
			window.addEventListener('resize', function () {
				vh = window.innerHeight || document.documentElement.clientHeight;
			}, { passive: true });

			twUpdate = function () {
				var r = anchor.getBoundingClientRect();
				// Nothing to do while the block is off screen. Without this the
				// whole slice-and-rewrite pass below ran on every scroll frame of
				// the entire page, not just the stretch where the effect is visible.
				if (r.bottom < 0 || r.top > vh) { return; }
				// Type as the text block rises from 82% to 30% of the viewport
				var start = vh * 0.82, end = vh * 0.30;
				var p = (start - r.top) / (start - end);
				p = Math.max(0, Math.min(1, p));
				var remaining = Math.round(p * total);
				items.forEach(function (it) {
					var n = Math.max(0, Math.min(it.len, remaining));
					if (it.n !== n) {
						it.typed.textContent = it.full.slice(0, n);
						it.rest.textContent = it.full.slice(n);
						it.el.classList.toggle('is-typing', n > 0 && n < it.len);
						it.n = n;
					}
					remaining -= it.len;
				});
			};
			twUpdate();

			// Hook for personalize.js: call after swapping the About copy so the
			// effect re-reads the new text instead of animating detached spans.
			window.cbAboutTypewriterRefresh = function () { build(); twUpdate(); };
		})();

		/* ---------- Scroll-linked FX: progress bar, hero fade, typewriter ---------- */
		var progressBar = document.querySelector('#scrollProgress i');
		var heroContent = document.querySelector('.hero__content');
		var fxTicking = false;
		function onScrollFX() {
			var st = window.scrollY || window.pageYOffset || 0;
			if (progressBar) {
				var h = document.documentElement.scrollHeight - window.innerHeight;
				progressBar.style.width = (h > 0 ? (st / h) * 100 : 0) + '%';
			}
			if (heroContent && !reduceMotion) {
				var o = Math.max(0, 1 - st / (window.innerHeight * 0.7));
				heroContent.style.opacity = o;
				heroContent.style.transform = 'translateY(' + (st * 0.15) + 'px)';
			}
			if (twUpdate) twUpdate();
		}
		window.addEventListener('scroll', function () {
			if (!fxTicking) { requestAnimationFrame(function () { onScrollFX(); fxTicking = false; }); fxTicking = true; }
		}, { passive: true });
		window.addEventListener('resize', onScrollFX, { passive: true });
		onScrollFX();

		/* ---------- Portfolio filter ---------- */
		var filterBtns = document.querySelectorAll('.filter__btn');
		var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
		filterBtns.forEach(function (btn) {
			btn.addEventListener('click', function () {
				filterBtns.forEach(function (b) { b.classList.remove('is-active'); });
				btn.classList.add('is-active');
				var group = btn.getAttribute('data-group');
				cards.forEach(function (card) {
					var groups = JSON.parse(card.getAttribute('data-groups') || '[]');
					var show;
					if (card.classList.contains('card--conditional')) {
						// Show if a visitor's interests already revealed it (within its groups),
						// or if the active filter is this card's designated reveal filter (e.g. Kremsegg on AI)
						var persoRevealed = card.classList.contains('is-revealed');
						var revealFilter = card.getAttribute('data-reveal-filter');
						var showByFilter = revealFilter && group === revealFilter;
						var showByPerso = persoRevealed && (group === 'all' || groups.indexOf(group) !== -1);
						show = showByFilter || showByPerso;
					} else {
						show = group === 'all' || groups.indexOf(group) !== -1;
					}
					if (show) {
						card.classList.remove('is-hidden');
						card.classList.add('is-enter');
						requestAnimationFrame(function () {
							requestAnimationFrame(function () { card.classList.remove('is-enter'); });
						});
					} else {
						card.classList.add('is-hidden');
					}
				});
			});
		});

		/* ---------- Modals ---------- */
		var modalRoot = document.getElementById('modalRoot');
		var overlay = document.getElementById('modalOverlay');
		var openModal = null;
		var lastFocus = null;

		function resetModal(m) {
			m.querySelectorAll('.modal__scroll').forEach(function (s) { s.scrollTop = 0; });
			m.querySelectorAll('video').forEach(function (v) { try { v.pause(); } catch (err) {} });
		}

		// Opens a case study by its data-modal-id. Safe to call while another modal
		// is already open: the two crossfade in place and the modal root never
		// toggles display, so there is no timing race between close and open.
		function open(id) {
			if (!id) return;
			var m = document.querySelector('.modal[data-modal-id="' + id + '"]');
			if (!m || m === openModal) return;

			if (openModal) {
				var prev = openModal;
				prev.classList.remove('is-active');
				setTimeout(function () { resetModal(prev); }, 400);
			} else {
				lastFocus = document.activeElement;
				modalRoot.classList.add('is-open');
				modalRoot.setAttribute('aria-hidden', 'false');
				document.body.style.overflow = 'hidden';
			}

			openModal = m;
			// Always start a newly opened case study at the top.
			m.querySelectorAll('.modal__scroll').forEach(function (s) { s.scrollTop = 0; });
			requestAnimationFrame(function () {
				requestAnimationFrame(function () {
					m.classList.add('is-active');
					m.querySelectorAll('video').forEach(function (v) {
						var p = v.play();
						if (p && p.catch) p.catch(function () {});
					});
					var head = m.querySelector('.modal__close');
					if (head) head.focus();
				});
			});
		}

		function close() {
			if (!openModal) return;
			var m = openModal;
			openModal = null;
			m.classList.remove('is-active');
			modalRoot.classList.remove('is-open');
			modalRoot.setAttribute('aria-hidden', 'true');
			document.body.style.overflow = '';
			setTimeout(function () { resetModal(m); }, 400);
			if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
			lastFocus = null;
		}

		// Delegated so it keeps working after personalize.js reorders or re-renders
		// cards, and so cross-links target the modal directly rather than its card
		// (a conditional card hidden for this visitor is still reachable this way).
		document.addEventListener('click', function (e) {
			var goto = e.target.closest('[data-modal-goto]');
			if (goto) {
				e.preventDefault();
				open(goto.getAttribute('data-modal-goto'));
				return;
			}
			var card = e.target.closest('.card[data-modal]');
			if (card) {
				open(card.getAttribute('data-modal'));
				return;
			}
			if (e.target.closest('.modal__close') || e.target.closest('.modal [data-close]') || e.target === overlay) {
				close();
			}
		});
		document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
	});

	/* ---------- Chatbot (same webhook as original) ---------- */
	var WEBHOOK = 'https://gomdeeu.app.n8n.cloud/webhook/cbcb438a-c24b-4e1c-b74d-bdabcba13ccb/chat';
	var GREETING = "I'm here to answer any questions you might have about Christian Bolorinos.";
	var initialized = false;
	var sessionId = localStorage.getItem('n8n-session');
	if (!sessionId) { sessionId = 'user-' + Math.random().toString(36).slice(2); localStorage.setItem('n8n-session', sessionId); }

	function parseMarkdown(text) {
		text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		text = text.replace(/^#{1,3} (.*?)$/gm, '<strong>$1</strong>');
		text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
		text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');
		text = text.replace(/\[(.*?)\]\((https?:\/\/[^\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
		text = text.replace(/(https?:\/\/[^\s]+)/g, function (m) {
			return m.indexOf('href') !== -1 ? m : '<a href="' + m + '" target="_blank" rel="noopener">' + m + '</a>';
		});
		return text.replace(/\n/g, '<br>');
	}
	function addMsg(text, role) {
		var msgs = document.getElementById('chat-messages');
		var div = document.createElement('div');
		div.className = 'msg ' + role;
		div.innerHTML = parseMarkdown(text);
		msgs.appendChild(div);
		msgs.scrollTop = msgs.scrollHeight;
		return div;
	}
	window.chatToggle = function () {
		var win = document.getElementById('chat-window');
		win.classList.toggle('open');
		if (win.classList.contains('open')) {
			if (!initialized) { addMsg(GREETING, 'bot'); initialized = true; }
			document.getElementById('chat-input').focus();
		}
	};
	window.chatSend = async function () {
		var input = document.getElementById('chat-input');
		var text = input.value.trim();
		if (!text) return;
		input.value = '';
		addMsg(text, 'user');
		var typing = addMsg('Typing…', 'bot typing');
		try {
			var res = await fetch(WEBHOOK, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ chatInput: text, action: 'sendMessage', sessionId: sessionId })
			});
			var data = await res.json();
			typing.remove();
			addMsg(data.output || data.text || data.message || data.reply || JSON.stringify(data), 'bot');
		} catch (e) {
			typing.remove();
			addMsg("Sorry, couldn't reach the server. Please try again.", 'bot');
		}
	};
})();
