"use client";

// New research form. Typing a company name suggests matching companies with their website
// (like a search box); picking one fills the website. Companies already on the watchlist are
// offered first and open their existing report instead of starting a duplicate.

import { useActionState, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { addCompany } from "@/app/actions";

const favicon = (domain) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;

export default function StartResearch() {
  const [state, action, pending] = useActionState(addCompany, null);
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [picked, setPicked] = useState(null); // suggestion the website came from
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const [more, setMore] = useState(false);
  const router = useRouter();
  const listId = useId();
  const reqRef = useRef(null);
  const timerRef = useRef(null);
  const websiteRef = useRef(null);

  useEffect(() => {
    if (state?.ok && state.id) router.push(`/company/${state.id}`);
  }, [state, router]);

  // Debounced lookup as the name is typed.
  const onNameChange = (value) => {
    setName(value);
    setPicked(null);
    setOpen(true);
    clearTimeout(timerRef.current);
    const q = value.trim();
    if (q.length < 2) {
      reqRef.current?.abort();
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    timerRef.current = setTimeout(async () => {
      reqRef.current?.abort();
      const ctrl = new AbortController();
      reqRef.current = ctrl;
      try {
        const res = await fetch(`/api/suggest?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const { items: found } = await res.json();
        setItems(found ?? []);
        setActive(found?.length ? 0 : -1);
      } catch {
        // aborted or offline: keep the previous list
      } finally {
        if (reqRef.current === ctrl) setLoading(false);
      }
    }, 200);
  };

  const choose = (item) => {
    setOpen(false);
    if (item.existingId && item.active !== false) {
      router.push(`/company/${item.existingId}`);
      return;
    }
    setName(item.name);
    setWebsite(item.domain ?? "");
    setPicked(item);
    websiteRef.current?.focus();
  };

  const onKeyDown = (e) => {
    if (!open || !items.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % items.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + items.length) % items.length); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); choose(items[active]); }
    else if (e.key === "Escape") { setOpen(false); }
  };

  const showList = open && name.trim().length >= 2 && !(picked && picked.name === name);

  return (
    <form action={action} className="start-form">
      <div className="field">
        <label className="field-label" htmlFor={`${listId}-name`}>Company name</label>
        <div className="combo">
          <span className="combo-icon" aria-hidden>
            {picked?.domain ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={favicon(picked.domain)} alt="" width={20} height={20} />
            ) : (
              <svg viewBox="0 0 24 24" width="18" height="18"><path d="M10.5 3a7.5 7.5 0 0 1 5.9 12.1l4.2 4.2-1.4 1.4-4.2-4.2A7.5 7.5 0 1 1 10.5 3Zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z" fill="currentColor" /></svg>
            )}
          </span>
          <input
            id={`${listId}-name`}
            className="input input-lg combo-input"
            name="name"
            required
            maxLength={80}
            autoComplete="off"
            autoFocus
            placeholder="Start typing, e.g. Datadog"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
          />
          {loading && <span className="combo-spinner" aria-hidden />}

          {showList && (items.length > 0 || !loading) && (
            <ul className="suggest" id={listId} role="listbox">
              {items.map((it, k) => (
                <li
                  key={`${it.source}-${it.name}-${it.domain}`}
                  id={`${listId}-${k}`}
                  role="option"
                  aria-selected={k === active}
                  className={`suggest-item ${k === active ? "active" : ""}`}
                  onMouseDown={(e) => { e.preventDefault(); choose(it); }}
                  onMouseEnter={() => setActive(k)}
                >
                  {it.domain ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={favicon(it.domain)} alt="" width={24} height={24} className="suggest-logo" loading="lazy" />
                  ) : (
                    <span className="suggest-logo initials">{it.name[0]}</span>
                  )}
                  <span className="suggest-text">
                    <span className="suggest-name">{highlight(it.name, name)}</span>
                    <span className="suggest-domain">{it.domain || "no website on record"}</span>
                  </span>
                  {it.existingId && (
                    <span className="suggest-badge">{it.active === false ? "Removed · re-add" : "On your watchlist · open"}</span>
                  )}
                </li>
              ))}
              {!items.length && !loading && (
                <li className="suggest-empty">No match found. Keep typing, or enter the website below yourself.</li>
              )}
            </ul>
          )}
        </div>
      </div>

      <div className="field">
        <label className="field-label" htmlFor={`${listId}-web`}>
          Website {picked?.domain && website === picked.domain ? <span className="autofill">✓ filled in for you</span> : <span className="muted">· helps us find the right company</span>}
        </label>
        <input
          id={`${listId}-web`}
          ref={websiteRef}
          className={`input input-lg ${picked?.domain && website === picked.domain ? "input-filled" : ""}`}
          name="website"
          autoComplete="off"
          placeholder="e.g. datadoghq.com"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      {more ? (
        <div className="form-grid two">
          <label className="field">
            <span className="field-label">GitHub handle (optional)</span>
            <input className="input mono" name="github_org" placeholder="e.g. DataDog" autoComplete="off" />
          </label>
          <label className="field">
            <span className="field-label">Job board (optional)</span>
            <input className="input mono" name="job_board" placeholder="e.g. greenhouse:datadog" autoComplete="off" />
          </label>
        </div>
      ) : (
        <button type="button" className="btn-text subtle more-toggle" onClick={() => setMore(true)}>+ GitHub handle or job board (optional)</button>
      )}

      <button type="submit" className="btn btn-lg btn-block btn-primary" disabled={pending || state?.ok}>
        {pending || state?.ok ? <><span className="spinner light" aria-hidden /> Starting research…</> : "Start research →"}
      </button>
      {state?.error && (
        <p className="form-msg error" role="alert">
          {state.error} {state.existingId && <Link href={`/company/${state.existingId}`}>Open its report →</Link>}
        </p>
      )}
    </form>
  );
}

/** Bold the part of the name that matches what was typed, like a search engine does. */
function highlight(text, query) {
  const q = query.trim();
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}
    </>
  );
}
