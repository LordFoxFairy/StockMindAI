/**
 * Covariance Matrix Estimation with Ledoit-Wolf Shrinkage
 *
 * Sample Covariance: S = (1/n) * X^T * X  (demeaned)
 *
 * Ledoit-Wolf Shrinkage:
 *   Sigma_shrunk = (1 - alpha) * S + alpha * F
 *   where F = structured target (constant correlation model)
 *   alpha = optimal shrinkage intensity (analytical formula)
 */

import { mean } from './risk';

// ── Sample Covariance Matrix ─────────────────────────────────────────────────

/**
 * Compute the sample covariance matrix from a returns matrix.
 * Each row of returnsMatrix is a time series of returns for one asset.
 * returnsMatrix[i][t] = return of asset i at time t.
 *
 * @param returnsMatrix Array of return series, one per asset. All must be same length.
 * @returns p x p covariance matrix where p = number of assets
 */
export function sampleCovariance(returnsMatrix: number[][]): number[][] {
  const p = returnsMatrix.length; // number of assets
  if (p === 0) return [];
  const n = returnsMatrix[0].length; // number of observations
  if (n === 0) return Array.from({ length: p }, () => new Array(p).fill(0));

  // Demean each asset's returns
  const means: number[] = [];
  const demeaned: number[][] = [];
  for (let i = 0; i < p; i++) {
    const m = mean(returnsMatrix[i]);
    means.push(m);
    demeaned.push(returnsMatrix[i].map(r => r - m));
  }

  // Compute covariance matrix: S[i][j] = (1/n) * sum_t(demeaned[i][t] * demeaned[j][t])
  const cov: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  for (let i = 0; i < p; i++) {
    for (let j = i; j < p; j++) {
      let sum = 0;
      for (let t = 0; t < n; t++) {
        sum += demeaned[i][t] * demeaned[j][t];
      }
      const val = sum / n;
      cov[i][j] = val;
      cov[j][i] = val;
    }
  }

  return cov;
}

// ── Ledoit-Wolf Shrinkage ────────────────────────────────────────────────────

export interface LedoitWolfResult {
  shrunkCov: number[][];
  shrinkageIntensity: number;
}

/**
 * Ledoit-Wolf shrinkage estimator with constant correlation target.
 *
 * The structured target F is a constant correlation matrix:
 *   F[i][j] = rho_bar * sqrt(S[i][i] * S[j][j])  for i != j
 *   F[i][i] = S[i][i]
 * where rho_bar is the average sample correlation.
 *
 * The optimal shrinkage intensity alpha is computed analytically following
 * Ledoit & Wolf (2004) "Honey, I Shrunk the Sample Covariance Matrix".
 *
 * @param returnsMatrix Array of return series, one per asset
 * @returns Shrunk covariance matrix and the optimal shrinkage intensity
 */
export function ledoitWolfShrinkage(returnsMatrix: number[][]): LedoitWolfResult {
  const p = returnsMatrix.length;
  if (p === 0) return { shrunkCov: [], shrinkageIntensity: 0 };
  const n = returnsMatrix[0].length;
  if (n < 2) {
    return {
      shrunkCov: Array.from({ length: p }, () => new Array(p).fill(0)),
      shrinkageIntensity: 1,
    };
  }

  // Demean
  const means: number[] = [];
  const X: number[][] = [];
  for (let i = 0; i < p; i++) {
    const m = mean(returnsMatrix[i]);
    means.push(m);
    X.push(returnsMatrix[i].map(r => r - m));
  }

  // Sample covariance S
  const S: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  for (let i = 0; i < p; i++) {
    for (let j = i; j < p; j++) {
      let sum = 0;
      for (let t = 0; t < n; t++) {
        sum += X[i][t] * X[j][t];
      }
      const val = sum / n;
      S[i][j] = val;
      S[j][i] = val;
    }
  }

  // Compute standard deviations
  const sqrtVar: number[] = new Array(p);
  for (let i = 0; i < p; i++) {
    sqrtVar[i] = Math.sqrt(Math.max(S[i][i], 1e-20));
  }

  // Compute average correlation (rho_bar)
  let corrSum = 0;
  let corrCount = 0;
  for (let i = 0; i < p; i++) {
    for (let j = i + 1; j < p; j++) {
      corrSum += S[i][j] / (sqrtVar[i] * sqrtVar[j]);
      corrCount++;
    }
  }
  const rhoBar = corrCount > 0 ? corrSum / corrCount : 0;

  // Target matrix F: constant correlation model
  const F: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < p; j++) {
      if (i === j) {
        F[i][j] = S[i][i];
      } else {
        F[i][j] = rhoBar * sqrtVar[i] * sqrtVar[j];
      }
    }
  }

  // ── Compute optimal shrinkage intensity (Ledoit-Wolf analytical formula) ──

  // Compute pi_hat: sum of asymptotic variances of S[i][j] entries
  // pi_ij = (1/n) * sum_t[(x_it * x_jt - s_ij)^2]
  let piSum = 0;
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < p; j++) {
      let piij = 0;
      for (let t = 0; t < n; t++) {
        const dev = X[i][t] * X[j][t] - S[i][j];
        piij += dev * dev;
      }
      piij /= n;
      piSum += piij;
    }
  }

  // Compute rho_hat: sum of asymptotic covariances of F[i][j] and S[i][j]
  // For constant correlation target, we need:
  // rho = sum_i(pi_ii) + sum_{i!=j} rhoBar * sqrt(s_jj/s_ii) * theta_ij
  // where theta_ij = (1/n) * sum_t[(x_it^2 * x_jt - s_ii * x_jt)(for the i-th sqrt factor)]

  // Simplified: compute rho as the sum of diagonal pi's plus off-diagonal terms
  let rhoHat = 0;

  // Diagonal part: rho for diagonal elements = pi_ii (since F_ii = S_ii)
  for (let i = 0; i < p; i++) {
    let piDiag = 0;
    for (let t = 0; t < n; t++) {
      const dev = X[i][t] * X[i][t] - S[i][i];
      piDiag += dev * dev;
    }
    piDiag /= n;
    rhoHat += piDiag;
  }

  // Off-diagonal part
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < p; j++) {
      if (i === j) continue;

      // theta_ij = (1/n) * sum_t[x_it * x_jt * (x_it^2 - S[i][i])]
      let thetaIJ = 0;
      for (let t = 0; t < n; t++) {
        thetaIJ += X[j][t] * X[i][t] * (X[i][t] * X[i][t] - S[i][i]);
      }
      thetaIJ /= n;

      let thetaJI = 0;
      for (let t = 0; t < n; t++) {
        thetaJI += X[i][t] * X[j][t] * (X[j][t] * X[j][t] - S[j][j]);
      }
      thetaJI /= n;

      const si = sqrtVar[i];
      const sj = sqrtVar[j];

      if (si > 1e-20 && sj > 1e-20) {
        rhoHat += rhoBar * 0.5 * (
          (sj / si) * thetaIJ + (si / sj) * thetaJI
        );
      }
    }
  }

  // Compute gamma_hat: squared Frobenius norm of (F - S)
  let gammaHat = 0;
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < p; j++) {
      const diff = F[i][j] - S[i][j];
      gammaHat += diff * diff;
    }
  }

  // Optimal shrinkage intensity
  // kappa = (pi_hat - rho_hat) / gamma_hat
  const kappa = (piSum - rhoHat) / Math.max(gammaHat, 1e-20);
  const alpha = Math.max(0, Math.min(1, kappa / n));

  // Shrunk covariance: (1 - alpha) * S + alpha * F
  const shrunkCov: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < p; j++) {
      shrunkCov[i][j] = (1 - alpha) * S[i][j] + alpha * F[i][j];
    }
  }

  return { shrunkCov, shrinkageIntensity: alpha };
}
