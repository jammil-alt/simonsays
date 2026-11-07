/* Thin client for the Worker's REST API. Every call returns parsed JSON or throws
   an Error with a stable `code` (see ERR_TEXT in app.js for the friendly wording). */
window.API = (() => {
  const fail = (code, message, status) => Object.assign(new Error(message || code), { code, status });

  async function req(method, path, { json, body, headers, signal } = {}) {
    let r;
    try {
      r = await fetch(path, {
        method,
        signal,
        credentials: 'same-origin',
        // Cloudflare Access answers an expired session with a redirect to its login page.
        // Catch that instead of following it into a CORS error.
        redirect: 'manual',
        headers: json !== undefined ? { 'content-type': 'application/json' } : headers,
        body: json !== undefined ? JSON.stringify(json) : body,
      });
    } catch (e) {
      if (e?.name === 'AbortError') throw Object.assign(fail('cancelled'), { name: 'AbortError' });
      throw fail('offline', 'Could not reach the server');
    }
    if (r.type === 'opaqueredirect' || r.status === 401) throw fail('signed_out', 'Signed out', 401);
    const data = await r.json().catch(() => null);
    if (!r.ok) throw fail(data?.error?.code || 'http_' + r.status, data?.error?.message || r.statusText, r.status);
    return data;
  }

  const enc = encodeURIComponent;
  return {
    listAssignments: () => req('GET', '/api/assignments'),
    createAssignment: (fields) => req('POST', '/api/assignments', { json: fields }),
    getAssignment: (id) => req('GET', `/api/assignments/${enc(id)}`),
    updateAssignment: (id, fields) => req('PATCH', `/api/assignments/${enc(id)}`, { json: fields }),
    deleteAssignment: (id) => req('DELETE', `/api/assignments/${enc(id)}`),

    /** Upload one page as a JPEG blob. Resolves to {id, key, w, h}. */
    uploadPage: (assignmentId, blob, w, h) =>
      req('POST', `/api/assignments/${enc(assignmentId)}/pages?w=${w}&h=${h}`, { body: blob, headers: { 'content-type': 'image/jpeg' } }),
    movePage: (pageId, position) => req('PATCH', `/api/pages/${enc(pageId)}`, { json: { position } }),
    deletePage: (pageId) => req('DELETE', `/api/pages/${enc(pageId)}`),

    saveAnswer: (id, box) => req('PUT', `/api/answers/${enc(id)}`, { json: box }),
    deleteAnswer: (id) => req('DELETE', `/api/answers/${enc(id)}`),
    saveTyped: (pageId, vals) => req('PUT', `/api/pages/${enc(pageId)}/typed`, { json: { vals } }),

    /** Ask Claude (via the Worker) for a clean copy. Resolves to {data, at, model}. */
    makeClean: (pageId, signal) => req('POST', `/api/pages/${enc(pageId)}/clean`, { signal }),
    /** The child pressed Fix. body: {problem, note, page (marked HTML) | snippet}. Resolves to {data, at, canUndo}. */
    fixClean: (pageId, body, signal) => req('POST', `/api/pages/${enc(pageId)}/fix`, { json: body, signal }),
    /** Put the page back the way it was before the last Fix. */
    unfixClean: (pageId) => req('POST', `/api/pages/${enc(pageId)}/unfix`),

    /** Read tags off a page photo (small model). Resolves to {tags}. */
    autoTag: (pageId) => req('POST', `/api/pages/${enc(pageId)}/autotag`),
    setTags: (pageId, tags) => req('PUT', `/api/pages/${enc(pageId)}/tags`, { json: { tags } }),

    imgUrl: (key) => '/img/' + key,

    /* Typing games */
    gameScores: () => req('GET', '/api/games/scores'),
    saveGameScore: (round) => req('POST', '/api/games/scores', { json: round }),
    gameWords: () => req('GET', '/api/games/words'),
  };
})();
