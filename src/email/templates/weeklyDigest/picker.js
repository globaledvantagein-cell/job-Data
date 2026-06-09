const MAX_JOBS_PER_EMAIL = 8;

/**
 * Pick up to MAX_JOBS_PER_EMAIL jobs distributed fairly across the user's
 * categories. Returns { picked: { cat: [jobs] }, total: N }.
 *
 * Strategy: round-robin through categories, taking the freshest unused
 * job from each, until we hit the cap or run out.
 */
export function pickTopJobs(jobsByCategory, cap = MAX_JOBS_PER_EMAIL) {
    const cats = Object.keys(jobsByCategory);
    if (cats.length === 0) return { picked: {}, total: 0 };

    // Working copies — assume jobs in each bucket are already sorted by PostedDate desc
    const queues = {};
    for (const c of cats) queues[c] = [...(jobsByCategory[c] || [])];

    const picked = {};
    for (const c of cats) picked[c] = [];

    let total = 0;
    while (total < cap) {
        let progress = false;
        for (const c of cats) {
            if (queues[c].length === 0) continue;
            picked[c].push(queues[c].shift());
            total += 1;
            progress = true;
            if (total >= cap) break;
        }
        if (!progress) break;
    }

    // Drop empty cats so we don't render empty headings
    for (const c of cats) if (picked[c].length === 0) delete picked[c];

    return { picked, total };
}

export function buildSubject({ shownTotal }) {
    if (shownTotal === 1) return `Your weekly job digest — 1 new role in Germany`;
    return `Your weekly job digest — ${shownTotal} new roles in Germany`;
}

export function capitalizeFirst(s) {
    if (!s) return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
}

export { MAX_JOBS_PER_EMAIL };
