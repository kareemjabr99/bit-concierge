/**
 * Whether a URL in a reply is grounded by a URL a tool returned. Both gates
 * use it: the literal gate for "this link exists", the citation gate for "this
 * link attributes the sentence". Both arguments are lowercased and trimmed of
 * trailing punctuation by the caller.
 *
 * Asymmetric on purpose:
 *
 * - **A cited URL with no fragment** is grounded by a returned URL whose
 *   fragment is stripped. Retrieval returns chunks, and a chunk's URL carries
 *   the anchor of its section (`…/refund-policy#online-purchases`). A model
 *   linking the page itself is linking a page the tools returned. Requiring
 *   the anchor withheld a correct answer on 2026-10-11
 *   (`returns-who-pays-pickup`).
 * - **A cited URL with a fragment** must match a returned URL exactly. A
 *   fragment names a section, and a section nobody returned is invented,
 *   however real the page is.
 *
 * Nothing else is loosened: no query strings, no path prefixes, no host-only
 * match. The earlier citation rule accepted `page#anything` and `page?anything`
 * when the bare page was returned, which let a model invent the section.
 */
export const urlGroundedBy = (cited: string, returned: string): boolean =>
  cited.includes('#') ? cited === returned : cited === returned.split('#')[0];
