/**
 * residual.mjs — strip common factors out of a cross-section of returns.
 *
 * Three estimators of the same idea, kept in one file because they are three answers to one
 * question and separating them would hide that they share a multiplicity family:
 *   `pcaResiduals`     remove the top k principal components (the manual's RV02)
 *   `betaResiduals`    remove a rolling beta to one or more explicit factor series (RV03, RV10)
 *
 * THE THING THAT MAKES THIS DIFFERENT FROM PAIRS-COINTEGRATION-STATARB, which is already KILLED:
 * that study screened 105 named pairs for a cointegrating relationship and found none survived
 * BH-FDR. These estimate a common-factor model across the whole cross-section at once and trade
 * what is left over. Different estimator, different unit, much wider universe. It is not a
 * parameter change on a closed row.
 *
 * Power iteration rather than a full eigendecomposition: only the top few components are wanted,
 * the matrix is at most a few hundred square, and a dependency-free implementation can be tested
 * against a case whose answer is known by hand.
 */

/** Column means of a T x N matrix. */
function colMeans(X) {
  const T = X.length, N = X[0]?.length ?? 0;
  const m = new Array(N).fill(0);
  for (const row of X) for (let j = 0; j < N; j++) m[j] += row[j];
  return m.map((v) => v / T);
}

/**
 * Top-k eigenvectors of X'X by power iteration with deflation.
 *
 * Deflation subtracts each found component from the operator before searching for the next, so
 * component 2 is orthogonal to component 1 by construction rather than by luck of initialisation.
 * A deterministic start vector is used, not a random one: a random start makes the returned sign
 * of each component vary between runs, and a sign that flips between runs would flip the sign of
 * every residual built from it — a study that scores a long book would silently become a short one.
 */
export function topComponents(X, k = 3, iterations = 100) {
  const T = X.length, N = X[0]?.length ?? 0;
  if (!T || !N) return [];
  const mu = colMeans(X);
  const C = X.map((row) => row.map((v, j) => v - mu[j]));
  const found = [];
  for (let c = 0; c < Math.min(k, N); c++) {
    let v = new Array(N).fill(0).map((_, i) => Math.sin(i + 1 + c));   // deterministic, not random
    normalize(v);
    for (let it = 0; it < iterations; it++) {
      // w = C' C v, with each previously found component projected back out each pass.
      const Cv = C.map((row) => dot(row, v));
      let w = new Array(N).fill(0);
      for (let t = 0; t < T; t++) for (let j = 0; j < N; j++) w[j] += C[t][j] * Cv[t];
      for (const f of found) {
        const p = dot(w, f);
        for (let j = 0; j < N; j++) w[j] -= p * f[j];
      }
      if (!normalize(w)) break;
      v = w;
    }
    found.push(v);
  }
  return found;
}

function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
function normalize(v) {
  const n = Math.sqrt(dot(v, v));
  if (!(n > 1e-12)) return false;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return true;
}

/**
 * Residual of the LAST row of X after removing its projection onto the top k components.
 *
 * The last row and not all of them, because that is the only one a trading decision is made on and
 * returning the whole matrix invites scoring residuals that were fit with hindsight.
 */
export function pcaResiduals(X, k = 3) {
  const comps = topComponents(X, k);
  const mu = colMeans(X);
  const last = X[X.length - 1].map((v, j) => v - mu[j]);
  const resid = [...last];
  for (const f of comps) {
    const p = dot(last, f);
    for (let j = 0; j < resid.length; j++) resid[j] -= p * f[j];
  }
  return resid;
}

/**
 * OLS slope(s) and residual of `y` on one or more factor columns, with an intercept.
 *
 * Returns the residual of the LAST observation. Factors are passed as columns so that the one-
 * factor market case and the two-factor market-plus-momentum case are the same code path — a
 * separate single-factor routine is how the two drift apart.
 */
export function betaResiduals(y, factors) {
  const T = y.length, K = factors.length;
  if (T < K + 2) return null;
  // Design matrix with intercept, solved by normal equations. K is 1 or 2 here, so a 3x3 solve.
  const cols = [new Array(T).fill(1), ...factors];
  const P = cols.length;
  const A = Array.from({ length: P }, (_, i) => cols.map((c) => dotN(cols[i], c, T)));
  const b = cols.map((c) => dotN(c, y, T));
  const coef = solve(A, b);
  if (!coef) return null;
  let fit = 0;
  for (let p = 0; p < P; p++) fit += coef[p] * cols[p][T - 1];
  return y[T - 1] - fit;
}

function dotN(a, b, n) { let s = 0; for (let i = 0; i < n; i++) s += a[i] * b[i]; return s; }

/** Gaussian elimination with partial pivoting; null when the system is singular. */
export function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j];
    }
  }
  // After full Gauss-Jordan elimination M is diagonal, so each unknown is its own row's augmented
  // entry over its own pivot. `row[i]` is that pivot: the earlier `row[i][i]` indexed into a
  // scalar, which yielded undefined and turned every coefficient into NaN. NaN then propagated
  // into the fitted value and out as a NaN residual — which would have been ranked, sorted to one
  // end of the cross-section, and traded, rather than throwing.
  return M.map((row, i) => row[n] / row[i]);
}

/** z-score of the last value of `xs` against the series' own history. Null if flat or too short. */
export function zLast(xs, min = 20) {
  if (xs.length < min) return null;
  const m = xs.reduce((s, v) => s + v, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1));
  if (!(sd > 1e-12)) return null;
  return (xs[xs.length - 1] - m) / sd;
}

/**
 * Residuals for EVERY row of the window, from one fit on that window.
 *
 * The single-row versions above exist to make hindsight hard. This one hands back the whole
 * window, and it is legitimate under exactly one condition, which the caller must hold: THE WINDOW
 * MUST END STRICTLY BEFORE THE DECISION. A statistical-arbitrage signal is the path of a name's
 * residual, not one day of it, so the path has to be reconstructed from a single fit — refitting
 * per day would be point-in-time correct and roughly a thousand times slower for no change in what
 * is being measured. What is NOT legitimate is extending the window to include the days being
 * traded, which would fit the factor model on the outcome.
 */
export function pcaResidualMatrix(X, k = 3) {
  const comps = topComponents(X, k);
  const mu = colMeans(X);
  return X.map((row) => {
    const centred = row.map((v, j) => v - mu[j]);
    const resid = [...centred];
    for (const f of comps) {
      const p = dot(centred, f);
      for (let j = 0; j < resid.length; j++) resid[j] -= p * f[j];
    }
    return resid;
  });
}

/** The same for the explicit-factor case: one OLS fit on the window, residuals for every row. */
export function betaResidualSeries(y, factors) {
  const T = y.length;
  const cols = [new Array(T).fill(1), ...factors];
  const P = cols.length;
  if (T < P + 1) return null;
  const A = Array.from({ length: P }, (_, i) => cols.map((c) => dotN(cols[i], c, T)));
  const coef = solve(A, cols.map((c) => dotN(c, y, T)));
  if (!coef) return null;
  return y.map((v, t) => {
    let fit = 0;
    for (let p = 0; p < P; p++) fit += coef[p] * cols[p][t];
    return v - fit;
  });
}
