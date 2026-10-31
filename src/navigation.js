// OpenCode Go DeepSeek candidate, reviewed and corrected by Sol.
export function createNavigator(walls, { min = -89, max = 89, cellSize = 1, radius = 0.5 } = {}) {
  const cols = Math.max(1, Math.round((max - min) / cellSize));
  const rows = cols;
  const total = cols * rows;

  const occ = new Uint8Array(total);

  const half = cellSize * 0.5;
  for (const w of walls) {
    const hw = w.w * 0.5 + radius;
    const hd = w.d * 0.5 + radius;
    const x0 = w.x - hw, x1 = w.x + hw;
    const z0 = w.z - hd, z1 = w.z + hd;
    const c0 = Math.max(0, Math.floor((x0 - min) / cellSize));
    const c1 = Math.min(cols - 1, Math.floor((x1 - min) / cellSize));
    const r0 = Math.max(0, Math.floor((z0 - min) / cellSize));
    const r1 = Math.min(rows - 1, Math.floor((z1 - min) / cellSize));
    for (let r = r0; r <= r1; r++) {
      const zc = min + r * cellSize + half;
      if (zc < z0 || zc > z1) continue;
      const base = r * cols;
      for (let c = c0; c <= c1; c++) {
        const xc = min + c * cellSize + half;
        if (xc < x0 || xc > x1) continue;
        occ[base + c] = 1;
      }
    }
  }

  function cellCenter(c, r) {
    return [min + c * cellSize + half, min + r * cellSize + half];
  }

  function toCell(x, z) {
    const c = Math.floor((x - min) / cellSize);
    const r = Math.floor((z - min) / cellSize);
    if (c < 0 || c >= cols || r < 0 || r >= rows) return null;
    return [c, r];
  }

  function isBlocked(x, z) {
    const cc = toCell(x, z);
    if (!cc) return true;
    return occ[cc[1] * cols + cc[0]] === 1;
  }

  function segmentClear(x0,z0,x1,z1) {
    const dx=x1-x0,dz=z1-z0;
    if(x0<min+radius||x0>max-radius||z0<min+radius||z0>max-radius||x1<min+radius||x1>max-radius||z1<min+radius||z1>max-radius)return false;
    for(const w of walls){let lo=0,hi=1;let hit=true;
      for(const [origin,delta,low,high] of [[x0,dx,w.x-w.w/2-radius,w.x+w.w/2+radius],[z0,dz,w.z-w.d/2-radius,w.z+w.d/2+radius]]){
        if(Math.abs(delta)<1e-10){if(origin<low||origin>high){hit=false;break}}
        else{let t0=(low-origin)/delta,t1=(high-origin)/delta;if(t0>t1)[t0,t1]=[t1,t0];lo=Math.max(lo,t0);hi=Math.min(hi,t1);if(lo>hi){hit=false;break}}
      }if(hit)return false;
    }return true;
  }

  function heuristic(c0, r0, c1, r1) {
    const dx = Math.abs(c0 - c1);
    const dz = Math.abs(r0 - r1);
    return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz);
  }

  const NEIGHBORS = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2],
    [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
  ];

  function findPath(start, goal, maxNodes = 12000) {
    if (!start || !goal) return [];
    if (!Number.isFinite(start.x) || !Number.isFinite(start.z)) return [];
    if (!Number.isFinite(goal.x) || !Number.isFinite(goal.z)) return [];

    if (isBlocked(start.x, start.z)||!segmentClear(start.x,start.z,start.x,start.z)) return [];
    if (isBlocked(goal.x, goal.z)||!segmentClear(goal.x,goal.z,goal.x,goal.z)) return [];

    const sCell = toCell(start.x, start.z);
    const gCell = toCell(goal.x, goal.z);
    if (!sCell || !gCell) return [];

    const startIdx = sCell[1] * cols + sCell[0];
    const goalIdx = gCell[1] * cols + gCell[0];

    if (startIdx === goalIdx) {
      return segmentClear(start.x, start.z, goal.x, goal.z) ? [goal.x, goal.z] : [];
    }

    const gScore = new Float64Array(total).fill(Infinity);
    const fScore = new Float64Array(total).fill(Infinity);
    const cameFrom = new Int32Array(total).fill(-1);
    const closed = new Uint8Array(total);
    const open = new Uint8Array(total);

    const heapIdx = [];
    const heapF = [];

    function heapPush(idx, f) {
      let i = heapIdx.length;
      heapIdx.push(idx);
      heapF.push(f);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapF[p] <= heapF[i]) break;
        const ti = heapIdx[p], tf = heapF[p];
        heapIdx[p] = heapIdx[i]; heapF[p] = heapF[i];
        heapIdx[i] = ti; heapF[i] = tf;
        i = p;
      }
    }

    function heapPop() {
      const n = heapIdx.length;
      if (n === 0) return -1;
      const top = heapIdx[0];
      const lastIdx = heapIdx[n - 1];
      const lastF = heapF[n - 1];
      heapIdx.pop();
      heapF.pop();
      if (n > 1) {
        heapIdx[0] = lastIdx;
        heapF[0] = lastF;
        let i = 0;
        const size = heapIdx.length;
        while (true) {
          const l = i * 2 + 1;
          const r = l + 1;
          let smallest = i;
          if (l < size && heapF[l] < heapF[smallest]) smallest = l;
          if (r < size && heapF[r] < heapF[smallest]) smallest = r;
          if (smallest === i) break;
          const ti = heapIdx[i], tf = heapF[i];
          heapIdx[i] = heapIdx[smallest]; heapF[i] = heapF[smallest];
          heapIdx[smallest] = ti; heapF[smallest] = tf;
          i = smallest;
        }
      }
      return top;
    }

    const gC = gCell[0], gR = gCell[1];
    gScore[startIdx] = 0;
    fScore[startIdx] = heuristic(sCell[0], sCell[1], gC, gR);
    heapPush(startIdx, fScore[startIdx]);
    open[startIdx] = 1;

    let expanded = 0;

    while (heapIdx.length > 0) {
      if (expanded >= maxNodes) return [];
      const curIdx = heapPop();
      if (curIdx === -1) break;
      if (closed[curIdx]) continue;
      closed[curIdx] = 1;
      open[curIdx] = 0;
      expanded++;

      if (curIdx === goalIdx) {
        const cells = [];
        let c = curIdx;
        while (c !== -1) {
          cells.push(c);
          c = cameFrom[c];
        }
        cells.reverse();

        const waypoints = [];
        for (let i = 1; i < cells.length; i++) {
          const ci = cells[i];
          const cr = Math.floor(ci / cols);
          const cc = ci - cr * cols;
          const [wx, wz] = cellCenter(cc, cr);
          waypoints.push(wx, wz);
        }

        // Apply conservative LOS smoothing
        const pts = [];
        const startArr = [];
        startArr.push(start.x, start.z);
        for (let i = 0; i < waypoints.length; i += 2) {
          startArr.push(waypoints[i], waypoints[i + 1]);
        }
        let i = 0;
        const n = startArr.length / 2;
        while (i < n - 1) {
          let j = i + 1;
          let best = i + 1;
          // try to skip as far as possible, but cap look-ahead for conservatism
          const limit = Math.min(n - 1, i + 32);
          for (let k = i + 1; k <= limit; k++) {
            if (segmentClear(startArr[2 * i], startArr[2 * i + 1], startArr[2 * k], startArr[2 * k + 1])) {
              best = k;
            }
          }
          j = best;
          pts.push(startArr[2 * j], startArr[2 * j + 1]);
          i = j;
        }

        if (pts.length === 0) return [];
        let px=start.x,pz=start.z;for(let k=0;k<pts.length;k+=2){if(!segmentClear(px,pz,pts[k],pts[k+1]))return [];px=pts[k];pz=pts[k+1];}

        // Ensure last waypoint is exact goal if segment from previous is clear
        const lastX = pts[pts.length - 2];
        const lastZ = pts[pts.length - 1];
        if (segmentClear(lastX, lastZ, goal.x, goal.z)) {
          pts[pts.length - 2] = goal.x;
          pts[pts.length - 1] = goal.z;
        }

        // Remove start (already excluded) — pts contains subsequent waypoints ending in goal
        // Return world-coordinate pairs [x,z,...]
        return pts;
      }

      const cr = Math.floor(curIdx / cols);
      const cc = curIdx - cr * cols;

      for (let k = 0; k < NEIGHBORS.length; k++) {
        const [dc, dr, cost] = NEIGHBORS[k];
        const nc = cc + dc;
        const nr = cr + dr;
        if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
        const nIdx = nr * cols + nc;
        if (closed[nIdx]) continue;
        if (occ[nIdx] === 1) continue;

        // No corner cutting
        if (dc !== 0 && dr !== 0) {
          const a = cr * cols + nc;
          const b = nr * cols + cc;
          if (occ[a] === 1 || occ[b] === 1) continue;
        }

        const tentative = gScore[curIdx] + cost;
        if (tentative < gScore[nIdx]) {
          cameFrom[nIdx] = curIdx;
          gScore[nIdx] = tentative;
          const f = tentative + heuristic(nc, nr, gC, gR);
          fScore[nIdx] = f;
          if (!open[nIdx]) {
            open[nIdx] = 1;
            heapPush(nIdx, f);
          } else {
            // Decrease-key: simple approach, push duplicate
            heapPush(nIdx, f);
          }
        }
      }
    }

    return [];
  }

  return { findPath };
}