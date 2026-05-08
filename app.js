/* ==================================================================
 * Backgammon – Alpha
 * Eine schlanke Web-Implementierung mit NPC-Gegner.
 * Sprache: Deutsch.
 * ================================================================== */

(() => {
  'use strict';

  // -------------------- Konstanten & Hilfen --------------------
  const WHITE = 'white';
  const BLACK = 'black';

  /** Richtung der Bewegung: Weiß zieht 24→1, Schwarz zieht 1→24. */
  const DIR = { [WHITE]: -1, [BLACK]: +1 };

  /** Heimatzonen (Bear-off möglich, wenn alle Steine hier sind). */
  const HOME = {
    [WHITE]: [1, 2, 3, 4, 5, 6],
    [BLACK]: [19, 20, 21, 22, 23, 24]
  };

  const COLOR_DE = { [WHITE]: 'Weiß', [BLACK]: 'Schwarz' };

  // -------------------- Spielzustand --------------------
  let state = null;
  let stoneIdCounter = 0;

  function makeStone(color) {
    return { id: 'S' + (stoneIdCounter++), color };
  }

  function newGame(opts) {
    stoneIdCounter = 0;
    const points = Array.from({ length: 25 }, () => []);

    // Standard-Aufstellung
    const setup = [
      [24, WHITE, 2], [13, WHITE, 5], [8, WHITE, 3], [6, WHITE, 5],
      [1, BLACK, 2], [12, BLACK, 5], [17, BLACK, 3], [19, BLACK, 5]
    ];
    setup.forEach(([pt, col, n]) => {
      for (let i = 0; i < n; i++) points[pt].push(makeStone(col));
    });

    return {
      points,
      bar: { [WHITE]: [], [BLACK]: [] },
      off: { [WHITE]: [], [BLACK]: [] },
      current: WHITE,
      dice: [],          // verbleibende Augen, z.B. [3,5] oder [4,4,4,4]
      initialDice: [],   // originaler Wurf
      diceUsed: [],      // [{value, used: true}] – nur fürs Rendering
      phase: 'rolling',  // 'rolling' | 'moving' | 'gameover'
      history: [],       // Snapshots für Rückgängig
      log: [],
      opponent: opts.opponent,
      playerColor: opts.playerColor,
      autoConfirm: opts.autoConfirm,
      winner: null
    };
  }

  function isNpcTurn() {
    if (state.opponent === 'local') return false;
    return state.current !== state.playerColor;
  }

  // -------------------- Reine Funktionen über das Brett --------------------
  function topColor(points, idx) {
    return points[idx].length > 0 ? points[idx][0].color : null;
  }
  function ownerOf(points, idx) {
    if (points[idx].length === 0) return null;
    return points[idx][0].color;
  }
  function countAt(points, idx) {
    return points[idx].length;
  }

  function allInHome(s, color) {
    if (s.bar[color].length > 0) return false;
    const home = HOME[color];
    let total = home.reduce((a, p) => a + (ownerOf(s.points, p) === color ? countAt(s.points, p) : 0), 0);
    total += s.off[color].length;
    return total === 15;
  }

  function furthestFromOff(s, color) {
    // Für Weiß: höchster besetzter Punkt; für Schwarz: niedrigster
    if (color === WHITE) {
      for (let p = 24; p >= 1; p--) if (ownerOf(s.points, p) === WHITE) return p;
    } else {
      for (let p = 1; p <= 24; p++) if (ownerOf(s.points, p) === BLACK) return p;
    }
    return null;
  }

  function pipCount(s, color) {
    let pips = s.bar[color].length * 25;
    for (let p = 1; p <= 24; p++) {
      if (ownerOf(s.points, p) === color) {
        const dist = color === WHITE ? p : 25 - p;
        pips += dist * countAt(s.points, p);
      }
    }
    return pips;
  }

  // -------------------- Zugerzeugung --------------------
  /**
   * Erzeugt alle einzelnen legalen Halbzüge (für genau einen Würfel) für `color`
   * gegeben die aktuellen Punkte/bar.
   * Liefert Array von { from, to, die, kind } wobei kind ∈ 'enter','move','bear','hit'
   * (hit wird zusätzlich gesetzt, wenn am Ziel ein gegnerischer Blot steht).
   */
  function legalSubMoves(s, color, die) {
    const moves = [];
    const dir = DIR[color];
    const opp = color === WHITE ? BLACK : WHITE;

    // 1) Bar-Wiedereintritt: hat Vorrang
    if (s.bar[color].length > 0) {
      const entry = color === WHITE ? 25 - die : die;
      if (entry >= 1 && entry <= 24) {
        const owner = ownerOf(s.points, entry);
        if (owner === null || owner === color || countAt(s.points, entry) === 1) {
          const isHit = owner === opp && countAt(s.points, entry) === 1;
          moves.push({ from: 'bar', to: entry, die, kind: isHit ? 'hit' : 'enter' });
        }
      }
      return moves;
    }

    // 2) Reguläre Züge
    for (let from = 1; from <= 24; from++) {
      if (ownerOf(s.points, from) !== color) continue;
      const to = from + dir * die;

      if (to >= 1 && to <= 24) {
        const owner = ownerOf(s.points, to);
        if (owner === null || owner === color) {
          moves.push({ from, to, die, kind: 'move' });
        } else if (countAt(s.points, to) === 1) {
          moves.push({ from, to, die, kind: 'hit' });
        }
        // sonst: blockiert
      } else {
        // Bear-off?
        if (!allInHome(s, color)) continue;
        const exact = color === WHITE ? from === die : (25 - from) === die;
        if (exact) {
          moves.push({ from, to: 'off', die, kind: 'bear' });
        } else {
          // Nur erlaubt, wenn from der "höchste" Stein im Heimatbrett ist (relativ zur Auswurfrichtung)
          const furthest = furthestFromOff(s, color);
          const overshoots = color === WHITE ? from < die : (25 - from) < die;
          if (overshoots && furthest === from) {
            moves.push({ from, to: 'off', die, kind: 'bear' });
          }
        }
      }
    }
    return moves;
  }

  /** Wendet einen Halbzug auf einer (geklonten) Position an. Mutiert s. */
  function applySubMove(s, color, mv) {
    const opp = color === WHITE ? BLACK : WHITE;
    let stone;
    if (mv.from === 'bar') {
      stone = s.bar[color].pop();
    } else {
      stone = s.points[mv.from].pop();
    }
    if (mv.to === 'off') {
      s.off[color].push(stone);
    } else {
      // Schlagen?
      if (mv.kind === 'hit' && countAt(s.points, mv.to) === 1) {
        const hit = s.points[mv.to].pop();
        s.bar[opp].push(hit);
      }
      s.points[mv.to].push(stone);
    }
  }

  function cloneState(s) {
    const ns = {
      ...s,
      points: s.points.map(arr => arr.slice()),
      bar: { [WHITE]: s.bar[WHITE].slice(), [BLACK]: s.bar[BLACK].slice() },
      off: { [WHITE]: s.off[WHITE].slice(), [BLACK]: s.off[BLACK].slice() },
      dice: s.dice.slice(),
      initialDice: s.initialDice.slice(),
      diceUsed: s.diceUsed.map(d => ({ ...d })),
      history: [],
      log: s.log.slice()
    };
    return ns;
  }

  /**
   * Erzeugt alle möglichen kompletten Zugfolgen (Permutationen) für die gegebenen Würfel.
   * Liefert Array von Sequenzen: [{ moves:[mv,...], remainingDice:[...] }]
   * – Sequenzen, die ALLE Würfel verbrauchen, werden bevorzugt.
   */
  function enumerateSequences(s, color, dice) {
    const results = [];
    function recurse(curState, remaining, path) {
      if (remaining.length === 0) {
        results.push({ moves: path.slice(), remainingDice: [] });
        return;
      }
      // Probiere jeden noch nicht benutzten Würfel
      const tried = new Set();
      let anyMove = false;
      for (let i = 0; i < remaining.length; i++) {
        const d = remaining[i];
        if (tried.has(d)) continue;
        tried.add(d);
        const moves = legalSubMoves(curState, color, d);
        if (moves.length === 0) continue;
        anyMove = true;
        for (const mv of moves) {
          const next = cloneState(curState);
          applySubMove(next, color, mv);
          const rem = remaining.slice();
          rem.splice(i, 1);
          recurse(next, rem, path.concat([mv]));
        }
      }
      if (!anyMove) {
        results.push({ moves: path.slice(), remainingDice: remaining.slice() });
      }
    }
    recurse(s, dice, []);
    return results;
  }

  /** Maximal ausspielbare Anzahl Würfel. */
  function maxPlayable(seqs) {
    let max = 0;
    for (const s of seqs) if (s.moves.length > max) max = s.moves.length;
    return max;
  }

  /** Liefert legale Halbzüge für den Spieler – nur jene, die zu einer maximalen Sequenz gehören. */
  function legalNextMoves(s, color) {
    if (s.dice.length === 0) return [];
    const seqs = enumerateSequences(s, color, s.dice);
    const max = maxPlayable(seqs);
    if (max === 0) return [];
    // Wenn nur ein Würfel spielbar ist und beide Würfel unterschiedlich, muss der GROSSE benutzt werden, falls möglich.
    let validSeqs = seqs.filter(seq => seq.moves.length === max);
    if (max === 1 && s.dice.length === 2 && s.dice[0] !== s.dice[1]) {
      const bigDie = Math.max(...s.dice);
      const withBig = validSeqs.filter(seq => seq.moves[0] && seq.moves[0].die === bigDie);
      if (withBig.length > 0) validSeqs = withBig;
    }
    // Sammle die ersten Halbzüge dieser Sequenzen
    const seen = new Map();
    for (const seq of validSeqs) {
      const mv = seq.moves[0];
      if (!mv) continue;
      const key = `${mv.from}-${mv.to}-${mv.die}`;
      if (!seen.has(key)) seen.set(key, mv);
    }
    return Array.from(seen.values());
  }

  /**
   * Liefert für eine gewählte Quelle alle erreichbaren Ziele inkl. Compound-Pfade
   * (mehrere Würfel hintereinander auf demselben Stein – auch durch Zwischen-Schlag).
   * Bevorzugt pro Ziel den längsten Pfad (nutzt mehr Würfel = mehr Information).
   */
  function compoundOptionsFrom(s, color, src) {
    const allSeqs = enumerateSequences(s, color, s.dice);
    const max = maxPlayable(allSeqs);
    if (max === 0) return [];
    let valid = allSeqs.filter(seq => seq.moves.length === max);
    if (max === 1 && s.dice.length === 2 && s.dice[0] !== s.dice[1]) {
      const big = Math.max(...s.dice);
      const withBig = valid.filter(seq => seq.moves[0] && seq.moves[0].die === big);
      if (withBig.length > 0) valid = withBig;
    }

    // Sammle Optionen: Schlüssel = Ziel, Wert = bester (längster) Pfad
    const byTarget = new Map();
    for (const seq of valid) {
      let chainEnd = src;
      const path = [];
      let containsHit = false;
      for (const mv of seq.moves) {
        if (mv.from !== chainEnd) break;
        path.push(mv);
        if (mv.kind === 'hit') containsHit = true;
        chainEnd = (mv.to === 'off') ? null : mv.to;
        const key = String(mv.to);
        const existing = byTarget.get(key);
        if (!existing || path.length > existing.path.length) {
          byTarget.set(key, {
            target: mv.to,
            path: path.slice(),
            kind: containsHit ? 'hit' : mv.kind,
            dice: path.map(p => p.die)
          });
        }
        if (chainEnd === null) break;
      }
    }
    return Array.from(byTarget.values());
  }

  // -------------------- NPC-AI --------------------
  function evaluatePosition(s, color) {
    // Höher = besser für `color`.
    const opp = color === WHITE ? BLACK : WHITE;
    let score = 0;

    // Pip-Differenz (positiv ist gut)
    score += (pipCount(s, opp) - pipCount(s, color)) * 1.0;

    // Eigene Bear-offs sind viel wert
    score += s.off[color].length * 35;
    score -= s.off[opp].length * 35;

    // Bar (eigene auf der Bar = schlecht)
    score -= s.bar[color].length * 30;
    score += s.bar[opp].length * 25;

    // Blots/Punkte
    for (let p = 1; p <= 24; p++) {
      const owner = ownerOf(s.points, p);
      if (!owner) continue;
      const cnt = countAt(s.points, p);
      if (owner === color) {
        if (cnt === 1) {
          // Blot-Strafe abhängig davon, wie nah ein Gegner steht (vereinfacht: konstant + Position)
          const exposure = color === WHITE ? (25 - p) : p; // grob: wie weit vom eigenen Heimat-Ende
          score -= 8 + exposure * 0.2;
        } else {
          // Gemachter Punkt: Bonus, im Heimatbrett mehr
          const inHome = HOME[color].includes(p);
          score += 6 + (inHome ? 4 : 0) + Math.min(cnt - 2, 3) * 1.5;
          // Wichtige Punkte: 5er, 7er (Bar-Point), 4er des Gegners
          if (color === WHITE && [5, 7, 20].includes(p)) score += 4;
          if (color === BLACK && [20, 18, 5].includes(p)) score += 4;
        }
      }
    }

    // Prime-Bonus: zusammenhängende eigene Punkte
    let run = 0, bestRun = 0;
    for (let p = 1; p <= 24; p++) {
      if (ownerOf(s.points, p) === color && countAt(s.points, p) >= 2) {
        run++;
        if (run > bestRun) bestRun = run;
      } else run = 0;
    }
    score += bestRun * bestRun * 1.2;

    return score;
  }

  // Tabellierte Trefferwahrscheinlichkeit (vereinfacht, ohne Berücksichtigung von Sperrungen)
  const HIT_PROB = {
    1: 11/36, 2: 12/36, 3: 14/36, 4: 15/36, 5: 15/36, 6: 17/36,
    7: 6/36, 8: 6/36, 9: 5/36, 10: 3/36, 11: 2/36, 12: 3/36,
    15: 1/36, 16: 1/36, 18: 1/36, 20: 1/36, 24: 1/36
  };

  /** Approximierte Summe der Treffer-Wahrscheinlichkeiten auf alle eigenen Blots. */
  function blotExposure(s, color) {
    const opp = color === WHITE ? BLACK : WHITE;
    const oppDir = DIR[opp];
    let total = 0;
    for (let p = 1; p <= 24; p++) {
      if (ownerOf(s.points, p) !== color || countAt(s.points, p) !== 1) continue;
      let prob = 0;
      // Eigene Steine vom Gegner: Distanz von q (in Gegnerrichtung) bis p
      for (let q = 1; q <= 24; q++) {
        if (ownerOf(s.points, q) !== opp) continue;
        const dist = oppDir === +1 ? (p - q) : (q - p);
        if (dist <= 0) continue;
        if (HIT_PROB[dist]) prob += HIT_PROB[dist];
      }
      // Gegner auf der Bar: Distanz vom "Bar-Eintritt" zur Blot
      if (s.bar[opp].length > 0) {
        for (let entry = 1; entry <= 6; entry++) {
          const entryPoint = opp === WHITE ? 25 - entry : entry;
          const dist = oppDir === +1 ? (p - entryPoint) : (entryPoint - p);
          if (dist === 0) prob += HIT_PROB[entry] || 0;
          else if (dist > 0 && HIT_PROB[dist + entry]) prob += (HIT_PROB[dist + entry] || 0) * 0.5;
        }
      }
      total += Math.min(prob, 1.0);
    }
    return total;
  }

  /** Erweiterte Eval für „schwer". */
  function evaluatePositionDeep(s, color) {
    let score = evaluatePosition(s, color);
    // Treffer-Risiko: pro „erwartetem Treffer" deutliche Strafe
    score -= blotExposure(s, color) * 22;
    // Anker im gegnerischen Heimatbrett (nützlich für Back Game)
    const home = HOME[color === WHITE ? BLACK : WHITE];
    for (const p of home) {
      if (ownerOf(s.points, p) === color && countAt(s.points, p) >= 2) score += 5;
    }
    // Race-Bonus: wenn bereits weit vorne und kein Kontakt mehr, race-orientiert spielen
    const ourPip = pipCount(s, color);
    const oppPip = pipCount(s, color === WHITE ? BLACK : WHITE);
    if (ourPip < oppPip - 12) score += (oppPip - ourPip) * 0.4;
    return score;
  }

  function chooseAiSequence(s, color, level) {
    const seqs = enumerateSequences(s, color, s.dice);
    const max = maxPlayable(seqs);
    if (max === 0) return { moves: [], remainingDice: s.dice.slice() };
    let candidates = seqs.filter(seq => seq.moves.length === max);

    // "Großen Würfel verwenden"-Regel
    if (max === 1 && s.dice.length === 2 && s.dice[0] !== s.dice[1]) {
      const bigDie = Math.max(...s.dice);
      const withBig = candidates.filter(seq => seq.moves[0] && seq.moves[0].die === bigDie);
      if (withBig.length > 0) candidates = withBig;
    }

    if (level === 'easy') {
      candidates.forEach(c => c._score = evaluatePosition(simulate(s, color, c.moves), color) + Math.random() * 3);
      candidates.sort((a, b) => b._score - a._score);
      const cut = Math.max(1, Math.floor(candidates.length * 0.6));
      return candidates[Math.floor(Math.random() * cut)];
    }

    if (level === 'hard') {
      // Verfeinerte Eval + leichtes Lookahead über typische Gegner-Würfe (Sample)
      const sampleRolls = [[3,1],[6,5],[5,3],[4,2],[6,4],[5,5],[6,1],[4,4]];
      let best = null, bestScore = -Infinity;
      for (const c of candidates) {
        const sim = simulate(s, color, c.moves);
        let baseScore = evaluatePositionDeep(sim, color);
        // Mini-Lookahead: für ein paar Stichproben, wie der Gegner antworten könnte
        const opp = color === WHITE ? BLACK : WHITE;
        let oppPenalty = 0, samples = 0;
        for (const roll of sampleRolls) {
          const dice = roll[0] === roll[1] ? [roll[0],roll[0],roll[0],roll[0]] : roll.slice();
          const oppSeqs = enumerateSequences(sim, opp, dice);
          if (oppSeqs.length === 0) continue;
          const oppMax = maxPlayable(oppSeqs);
          const oppValid = oppSeqs.filter(x => x.moves.length === oppMax);
          let worst = +Infinity;
          // Top-K opp moves nach schneller Bewertung
          const ranked = oppValid.map(o => ({ seq: o, sc: evaluatePosition(simulate(sim, opp, o.moves), color) }));
          ranked.sort((a,b) => a.sc - b.sc);
          const topK = ranked.slice(0, 3);
          for (const r of topK) {
            if (r.sc < worst) worst = r.sc;
          }
          if (worst < +Infinity) { oppPenalty += worst; samples++; }
        }
        const finalScore = samples > 0
          ? baseScore * 0.55 + (oppPenalty / samples) * 0.45
          : baseScore;
        const noisy = finalScore + (Math.random() - 0.5) * 0.3;
        if (noisy > bestScore) { bestScore = noisy; best = c; }
      }
      return best;
    }

    // medium: voller eval + leichtes Rauschen
    let best = null, bestScore = -Infinity;
    for (const c of candidates) {
      const sim = simulate(s, color, c.moves);
      const sc = evaluatePosition(sim, color) + (Math.random() - 0.5) * 0.5;
      if (sc > bestScore) { bestScore = sc; best = c; }
    }
    return best;
  }

  function simulate(s, color, moves) {
    const sim = cloneState(s);
    for (const mv of moves) applySubMove(sim, color, mv);
    return sim;
  }

  /** Liefert eine kurze deutsche Begründung für einen Halbzug (im Kontext vor dem Zug). */
  function describeMove(beforeState, color, mv) {
    const colorName = COLOR_DE[color];
    const opp = color === WHITE ? BLACK : WHITE;
    const fromLabel = mv.from === 'bar' ? 'Bar' : `${mv.from}`;
    const toLabel = mv.to === 'off' ? 'aus' : `${mv.to}`;
    let reason;

    if (mv.from === 'bar') {
      reason = mv.kind === 'hit'
        ? `kommt von der Bar zurück und schlägt einen Blot auf ${mv.to}`
        : `kommt von der Bar auf Punkt ${mv.to}`;
    } else if (mv.to === 'off') {
      reason = `würfelt einen Stein von Punkt ${mv.from} aus`;
    } else if (mv.kind === 'hit') {
      reason = `schlägt ${COLOR_DE[opp]}-Blot auf Punkt ${mv.to}`;
    } else {
      // Erkenne: macht neuen Punkt? Verlässt Blot?
      const targetCount = countAt(beforeState.points, mv.to);
      const sourceCount = countAt(beforeState.points, mv.from);
      const targetOwner = ownerOf(beforeState.points, mv.to);
      const inHome = HOME[color].includes(mv.to);

      if (targetOwner === color && targetCount === 1) {
        reason = `macht Punkt ${mv.to}`;
      } else if (targetCount === 0) {
        reason = inHome ? `zieht in die Heimat (${mv.to})` : `zieht nach ${mv.to}`;
      } else {
        reason = `verstärkt Punkt ${mv.to}`;
      }
      if (sourceCount === 2) {
        reason += `, gibt aber Punkt ${mv.from} auf`;
      } else if (sourceCount === 1) {
        // Stein war Blot, jetzt weg → eher gut
        reason += ` (löst Blot auf ${mv.from})`;
      }
    }
    return `${colorName} ${fromLabel} → ${toLabel}: ${reason}`;
  }

  // -------------------- Zugausführung im realen State --------------------
  function snapshot() {
    return cloneState(state);
  }

  function pushHistory() {
    state.history.push(snapshot());
    if (state.history.length > 40) state.history.shift();
  }

  function rollDice() {
    const d1 = 1 + Math.floor(Math.random() * 6);
    const d2 = 1 + Math.floor(Math.random() * 6);
    if (d1 === d2) {
      state.dice = [d1, d1, d1, d1];
      state.initialDice = [d1, d1, d1, d1];
    } else {
      state.dice = [d1, d2];
      state.initialDice = [d1, d2];
    }
    state.diceUsed = state.initialDice.map(v => ({ value: v, used: false }));
    state.phase = 'moving';
  }

  function consumeDie(value) {
    const idx = state.dice.indexOf(value);
    if (idx >= 0) state.dice.splice(idx, 1);
    // markiere im diceUsed das erste passende, noch nicht benutzte
    for (const d of state.diceUsed) {
      if (d.value === value && !d.used) { d.used = true; break; }
    }
  }

  function checkWin() {
    if (state.off[WHITE].length === 15) state.winner = WHITE;
    else if (state.off[BLACK].length === 15) state.winner = BLACK;
    if (state.winner) state.phase = 'gameover';
  }

  function endTurn() {
    state.dice = [];
    state.initialDice = [];
    state.diceUsed = [];
    state.current = state.current === WHITE ? BLACK : WHITE;
    state.phase = 'rolling';
  }

  // -------------------- Rendering --------------------
  const elBoard = document.getElementById('board');
  const elDie1 = document.getElementById('die-1');
  const elDie2 = document.getElementById('die-2');
  const elDice = document.getElementById('dice');
  const elStatus = document.getElementById('status');
  const elInfo = document.getElementById('info');
  const elLog = document.getElementById('log');
  const elMovesLeft = document.getElementById('moves-left');
  const elBtnRoll = document.getElementById('btn-roll');
  const elBtnPass = document.getElementById('btn-pass');
  const elBtnUndo = document.getElementById('btn-undo');

  let selectedFrom = null;     // 'bar' oder Punkt-Index
  let compoundOptions = [];    // [{target, path, kind, dice}]
  let inputLocked = false;     // während Animationen blockieren

  function buildBoardSkeleton() {
    elBoard.innerHTML = '';

    const tl = document.createElement('div'); tl.className = 'quad top tl'; tl.style.gridColumn = '1';
    const tr = document.createElement('div'); tr.className = 'quad top tr'; tr.style.gridColumn = '3';
    const bl = document.createElement('div'); bl.className = 'quad bottom bl'; bl.style.gridColumn = '1';
    const br = document.createElement('div'); br.className = 'quad bottom br'; br.style.gridColumn = '3';

    // Punkte:
    // top-left:  13,14,15,16,17,18 (von links nach rechts)
    // top-right: 19,20,21,22,23,24
    // bot-left:  12,11,10,9,8,7
    // bot-right: 6,5,4,3,2,1
    const tlOrder = [13, 14, 15, 16, 17, 18];
    const trOrder = [19, 20, 21, 22, 23, 24];
    const blOrder = [12, 11, 10, 9, 8, 7];
    const brOrder = [6, 5, 4, 3, 2, 1];

    function addPoint(parent, idx, dirClass, lightDark) {
      const el = document.createElement('div');
      el.className = `point ${dirClass} ${lightDark}`;
      el.dataset.point = idx;
      const tri = document.createElement('div');
      tri.className = 'triangle';
      el.appendChild(tri);
      const num = document.createElement('div');
      num.className = 'num';
      num.textContent = idx;
      el.appendChild(num);
      parent.appendChild(el);
    }

    tlOrder.forEach((idx, i) => addPoint(tl, idx, 'down', i % 2 === 0 ? 'light' : 'dark'));
    trOrder.forEach((idx, i) => addPoint(tr, idx, 'down', i % 2 === 0 ? 'light' : 'dark'));
    blOrder.forEach((idx, i) => addPoint(bl, idx, 'up',   i % 2 === 0 ? 'dark'  : 'light'));
    brOrder.forEach((idx, i) => addPoint(br, idx, 'up',   i % 2 === 0 ? 'dark'  : 'light'));

    // Bar
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.dataset.role = 'bar';
    bar.style.gridColumn = '2';
    const barTop = document.createElement('div'); barTop.className = 'bar-half top'; barTop.dataset.color = BLACK;
    const barBot = document.createElement('div'); barBot.className = 'bar-half bottom'; barBot.dataset.color = WHITE;
    bar.appendChild(barTop); bar.appendChild(barBot);

    // Bear-off
    const off = document.createElement('div');
    off.className = 'bear-off';
    off.style.gridColumn = '4';
    const offTop = document.createElement('div'); offTop.className = 'bear-off-half top'; offTop.dataset.color = BLACK;
    const offBot = document.createElement('div'); offBot.className = 'bear-off-half bottom'; offBot.dataset.color = WHITE;
    offTop.innerHTML = '<div class="label">Schwarz</div><div class="count" data-count>0</div>';
    offBot.innerHTML = '<div class="count" data-count>0</div><div class="label">Weiß</div>';
    off.appendChild(offTop); off.appendChild(offBot);

    elBoard.appendChild(tl);
    elBoard.appendChild(bar);
    elBoard.appendChild(tr);
    elBoard.appendChild(off);
    elBoard.appendChild(bl);
    elBoard.appendChild(br);
  }

  function getPointEl(idx) {
    return elBoard.querySelector(`.point[data-point="${idx}"]`);
  }

  function snapshotRects() {
    const rects = {};
    document.querySelectorAll('.checker').forEach(el => {
      rects[el.dataset.id] = el.getBoundingClientRect();
    });
    return rects;
  }

  const MOVE_MS = 600;        // Steinanimation
  const SUB_STEP_MS = 1100;   // Pause zwischen NPC-Teilzügen / Compound-Schritten
  const ROLL_MS = 750;        // Würfel-Animation

  function applyFlip(oldRects) {
    document.querySelectorAll('.checker').forEach(el => {
      const oldRect = oldRects[el.dataset.id];
      if (!oldRect) return;
      const newRect = el.getBoundingClientRect();
      const dx = oldRect.left - newRect.left;
      const dy = oldRect.top - newRect.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      // Reflow erzwingen
      void el.offsetWidth;
      requestAnimationFrame(() => {
        el.style.transition = `transform ${MOVE_MS}ms cubic-bezier(.22,.9,.3,1), box-shadow 320ms`;
        el.style.transform = '';
      });
    });
  }

  function renderCheckers() {
    // Punkte
    for (let p = 1; p <= 24; p++) {
      const el = getPointEl(p);
      // Entferne nur Steine, behalte Triangle/Num
      el.querySelectorAll('.checker, .stack-count').forEach(c => c.remove());
      const stones = state.points[p];
      const count = stones.length;
      const isUp = el.classList.contains('up');
      const visible = Math.min(count, 5);
      // Stones gestapelt
      for (let i = 0; i < visible; i++) {
        const stone = stones[i];
        const cEl = document.createElement('div');
        cEl.className = `checker ${stone.color}`;
        cEl.dataset.id = stone.id;
        // Position relativ zum Punkt:
        // Punkt-Höhe ist variabel; wir nutzen prozentuale Offsets.
        // Stein-Größe: 78% der Punktbreite. Punkt ist deutlich höher als breit -> 5 Steine passen.
        const offset = i * 19;
        if (isUp) cEl.style.bottom = `${4 + offset}%`;
        else cEl.style.top = `${4 + offset}%`;
        el.appendChild(cEl);
      }
      if (count > 5) {
        const badge = document.createElement('div');
        badge.className = 'stack-count';
        badge.textContent = count;
        el.appendChild(badge);
      }
    }

    // Bar
    elBoard.querySelectorAll('.bar-half').forEach(half => {
      half.querySelectorAll('.checker').forEach(c => c.remove());
      const color = half.dataset.color;
      state.bar[color].forEach(stone => {
        const cEl = document.createElement('div');
        cEl.className = `checker ${stone.color}`;
        cEl.dataset.id = stone.id;
        half.appendChild(cEl);
      });
    });

    // Bear-off
    elBoard.querySelectorAll('.bear-off-half').forEach(half => {
      const color = half.dataset.color;
      const cnt = half.querySelector('[data-count]');
      cnt.textContent = state.off[color].length;
    });

    // Auswahl/Highlights
    applyHighlights();
  }

  function clearMarkers() {
    elBoard.querySelectorAll('.target-marker').forEach(el => el.remove());
    elBoard.querySelectorAll('.point').forEach(el => el.classList.remove('selected'));
    elBoard.querySelectorAll('.bar-half').forEach(el => el.classList.remove('selected'));
    elBoard.querySelectorAll('.bear-off-half').forEach(el => el.classList.remove('target-ok'));
  }

  function makeMarker(kind, isUp, dice) {
    const m = document.createElement('div');
    m.className = `target-marker${kind === 'hit' ? ' hit' : ''}`;
    // Symbol: Pfeil vs. Kreuz – Form unterscheidet auch ohne Farbe
    m.textContent = kind === 'hit' ? '✕' : (isUp ? '↑' : '↓');
    if (dice && dice.length > 0) {
      const badge = document.createElement('div');
      badge.className = 'dice-badge';
      badge.textContent = dice.length === 1 ? `${dice[0]}` : `${dice[0]}+${dice.slice(1).join('+')}`;
      m.appendChild(badge);
    }
    return m;
  }

  function applyHighlights() {
    clearMarkers();
    elBoard.querySelectorAll('.checker').forEach(c => c.classList.remove('movable'));

    if (state.phase !== 'moving' || isNpcTurn()) {
      compoundOptions = [];
      return;
    }

    // Welche Halbzüge sind insgesamt möglich (Quellen ableiten)?
    const moves = legalNextMoves(state, state.current);

    // Markiere Quellen
    const sources = new Set(moves.map(m => m.from));
    sources.forEach(src => {
      if (src === 'bar') {
        const half = elBoard.querySelector(`.bar-half[data-color="${state.current}"]`);
        if (half) {
          const lastChecker = half.querySelector('.checker:last-child');
          if (lastChecker) lastChecker.classList.add('movable');
        }
      } else {
        const el = getPointEl(src);
        if (el) {
          const checkers = el.querySelectorAll('.checker');
          if (checkers.length > 0) checkers[checkers.length - 1].classList.add('movable');
        }
      }
    });

    if (selectedFrom !== null) {
      let srcEl;
      if (selectedFrom === 'bar') {
        srcEl = elBoard.querySelector(`.bar-half[data-color="${state.current}"]`);
      } else {
        srcEl = getPointEl(selectedFrom);
      }
      if (srcEl) srcEl.classList.add('selected');

      compoundOptions = compoundOptionsFrom(state, state.current, selectedFrom);
      compoundOptions.forEach(opt => {
        if (opt.target === 'off') {
          const half = elBoard.querySelector(`.bear-off-half[data-color="${state.current}"]`);
          if (half) half.classList.add('target-ok');
        } else {
          const el = getPointEl(opt.target);
          if (el) {
            const isUp = el.classList.contains('up');
            const marker = makeMarker(opt.kind, isUp, opt.dice);
            el.appendChild(marker);
          }
        }
      });
    } else {
      compoundOptions = [];
    }
  }

  function renderDice() {
    const useDie = (el, slot) => {
      const d = state.diceUsed[slot];
      if (!d) {
        el.textContent = '–';
        el.classList.remove('used', 'glow');
        return;
      }
      el.textContent = d.value;
      el.classList.toggle('used', d.used);
      el.classList.toggle('glow', !d.used && state.phase === 'moving' && !isNpcTurn());
    };
    // Bei Doppelpasch zeigen wir zwei Würfel mit gleichem Wert; Anzahl verbleibend in moves-left
    useDie(elDie1, 0);
    useDie(elDie2, 1);

    // Verbleibende Augen
    if (state.dice.length === 0) {
      elMovesLeft.textContent = state.phase === 'rolling' ? '' : 'Keine Würfel mehr.';
    } else if (state.initialDice.length === 4) {
      elMovesLeft.textContent = `Pasch ${state.initialDice[0]}: noch ${state.dice.length} Züge`;
    } else {
      elMovesLeft.textContent = `Verbleibend: ${state.dice.join(', ')}`;
    }
  }

  function renderStatus() {
    if (state.phase === 'gameover') {
      elStatus.textContent = `${COLOR_DE[state.winner]} hat gewonnen!`;
      return;
    }
    const who = COLOR_DE[state.current];
    const npc = isNpcTurn() ? ' (NPC denkt nach…)' : '';
    if (state.phase === 'rolling') {
      elStatus.textContent = `${who} ist am Zug – würfeln`;
    } else {
      elStatus.textContent = `${who} ist am Zug${npc}`;
    }
  }

  function renderControls() {
    const npcTurn = isNpcTurn();
    elBtnRoll.disabled = npcTurn || state.phase !== 'rolling' || state.phase === 'gameover';
    elBtnPass.disabled = npcTurn || state.phase !== 'moving' || state.dice.length === 0;
    elBtnUndo.disabled = state.history.length === 0 || npcTurn;

    if (state.phase === 'moving' && !npcTurn) {
      const moves = legalNextMoves(state, state.current);
      if (moves.length === 0) {
        elBtnPass.disabled = false;
        elBtnPass.textContent = 'Kein Zug möglich – weiter';
      } else {
        elBtnPass.textContent = 'Zug beenden';
      }
    } else {
      elBtnPass.textContent = 'Zug beenden';
    }
  }

  function renderInfo(text) {
    if (text !== undefined) {
      elInfo.textContent = text;
      return;
    }
    if (state.phase === 'gameover') {
      elInfo.textContent = `${COLOR_DE[state.winner]} hat alle 15 Steine ausgewürfelt.`;
      return;
    }
    if (state.phase === 'rolling') {
      elInfo.textContent = isNpcTurn() ? 'Der NPC würfelt gleich…' : 'Klicke „Werfen“, um die Würfel zu rollen.';
      return;
    }
    if (state.bar[state.current].length > 0 && !isNpcTurn()) {
      elInfo.textContent = 'Du hast Steine auf der Bar – sie müssen zuerst eintreten.';
      return;
    }
    const moves = legalNextMoves(state, state.current);
    if (moves.length === 0 && !isNpcTurn()) {
      elInfo.textContent = 'Kein legaler Zug möglich. Du musst aussetzen.';
      return;
    }
    if (!isNpcTurn()) {
      elInfo.textContent = selectedFrom === null
        ? 'Wähle einen deiner Steine.'
        : 'Wähle ein hervorgehobenes Zielfeld – oder klicke erneut zum Abwählen.';
    } else {
      elInfo.textContent = 'Der NPC ist am Zug.';
    }
  }

  function appendLog(msg, kind = 'system', reason = null) {
    const li = document.createElement('li');
    li.className = kind;
    li.textContent = msg;
    if (reason) {
      const r = document.createElement('span');
      r.className = 'reason';
      r.textContent = reason;
      li.appendChild(r);
    }
    elLog.appendChild(li);
    elLog.scrollTop = elLog.scrollHeight;
    state.log.push({ msg, kind, reason });
  }

  function rerender(animated = true) {
    let oldRects = null;
    if (animated) oldRects = snapshotRects();
    renderCheckers();
    if (animated && oldRects) applyFlip(oldRects);
    renderDice();
    renderStatus();
    renderControls();
    renderInfo();
  }

  // -------------------- Klick-Handler (Spieler) --------------------
  function onBoardClick(e) {
    if (state.phase !== 'moving' || isNpcTurn() || inputLocked) return;

    const point = e.target.closest('.point');
    const barHalf = e.target.closest('.bar-half');
    const offHalf = e.target.closest('.bear-off-half');

    // 1) Wenn Quelle ausgewählt, prüfe Ziel
    if (selectedFrom !== null) {
      if (point) {
        const targetIdx = parseInt(point.dataset.point, 10);
        const opt = compoundOptions.find(o => o.target === targetIdx);
        if (opt) { executePlayerPath(opt); return; }
      }
      if (offHalf && offHalf.dataset.color === state.current) {
        const opt = compoundOptions.find(o => o.target === 'off');
        if (opt) { executePlayerPath(opt); return; }
      }
      // Klick auf Quelle erneut → abwählen
      if ((point && parseInt(point.dataset.point, 10) === selectedFrom) ||
          (barHalf && selectedFrom === 'bar' && barHalf.dataset.color === state.current)) {
        selectedFrom = null;
        applyHighlights();
        renderInfo();
        return;
      }
      // Klick auf andere eigene Quelle → umwählen
      const newSrc = (barHalf && barHalf.dataset.color === state.current && state.bar[state.current].length > 0)
        ? 'bar'
        : (point && ownerOf(state.points, parseInt(point.dataset.point, 10)) === state.current)
          ? parseInt(point.dataset.point, 10) : null;
      if (newSrc !== null) {
        const moves = legalNextMoves(state, state.current);
        if (moves.some(m => m.from === newSrc)) {
          selectedFrom = newSrc;
          applyHighlights();
          renderInfo();
          return;
        }
      }
      selectedFrom = null;
      applyHighlights();
      renderInfo();
      return;
    }

    // 2) Keine Quelle gewählt – wähle eine
    if (state.bar[state.current].length > 0) {
      if (barHalf && barHalf.dataset.color === state.current) {
        selectedFrom = 'bar';
        applyHighlights();
        renderInfo();
      }
      return;
    }
    if (point) {
      const idx = parseInt(point.dataset.point, 10);
      if (ownerOf(state.points, idx) !== state.current) return;
      const moves = legalNextMoves(state, state.current);
      if (!moves.some(m => m.from === idx)) return;
      selectedFrom = idx;
      applyHighlights();
      renderInfo();
    }
  }

  /** Spielt einen Pfad (1+ Halbzüge) mit Pause zwischen den Schritten ab. */
  function executePlayerPath(opt) {
    inputLocked = true;
    selectedFrom = null;
    pushHistory();
    let i = 0;
    const playStep = () => {
      if (i >= opt.path.length) {
        inputLocked = false;
        checkWin();
        if (state.phase === 'gameover') { finishGame(); return; }
        if (state.dice.length === 0 || legalNextMoves(state, state.current).length === 0) {
          setTimeout(() => {
            endTurn();
            rerender(false);
            scheduleNpcIfNeeded();
          }, 500);
        } else {
          rerender(false); // letzte Highlights aktualisieren
        }
        return;
      }
      const mv = opt.path[i++];
      const desc = describeMove(state, state.current, mv);
      applySubMove(state, state.current, mv);
      consumeDie(mv.die);
      appendLog(desc, state.current === state.playerColor ? 'you' : 'npc');
      rerender(true);
      checkWin();
      if (state.phase === 'gameover') { finishGame(); return; }
      // Pause zwischen Compound-Schritten
      setTimeout(playStep, i < opt.path.length ? SUB_STEP_MS : MOVE_MS + 80);
    };
    playStep();
  }

  // -------------------- NPC-Steuerung --------------------
  function scheduleNpcIfNeeded() {
    if (state.phase === 'gameover') return;
    if (!isNpcTurn()) return;
    setTimeout(npcRoll, 600);
  }

  function npcRoll() {
    if (state.phase !== 'rolling' || !isNpcTurn()) return;
    elDie1.classList.add('rolling');
    elDie2.classList.add('rolling');
    setTimeout(() => {
      rollDice();
      elDie1.classList.remove('rolling');
      elDie2.classList.remove('rolling');
      const dieMsg = state.initialDice.length === 4
        ? `${COLOR_DE[state.current]} würfelt Pasch ${state.initialDice[0]}.`
        : `${COLOR_DE[state.current]} würfelt ${state.initialDice[0]} und ${state.initialDice[1]}.`;
      appendLog(dieMsg, 'npc');
      rerender(false);
      setTimeout(npcPlay, 800);
    }, ROLL_MS);
  }

  function npcPlay() {
    if (!isNpcTurn() || state.phase !== 'moving') return;
    const level = state.opponent === 'npc-easy' ? 'easy'
                : state.opponent === 'npc-hard' ? 'hard'
                : 'medium';
    const seq = chooseAiSequence(state, state.current, level);
    if (!seq || seq.moves.length === 0) {
      appendLog(`${COLOR_DE[state.current]} kann keinen Zug machen.`, 'system');
      setTimeout(() => {
        endTurn();
        rerender(false);
        scheduleNpcIfNeeded();
      }, 700);
      return;
    }
    // Schrittweise abspielen
    let i = 0;
    const playStep = () => {
      if (i >= seq.moves.length) {
        setTimeout(() => {
          endTurn();
          rerender(false);
          scheduleNpcIfNeeded();
        }, 700);
        return;
      }
      const mv = seq.moves[i++];
      const desc = describeMove(state, state.current, mv);
      pushHistory();
      applySubMove(state, state.current, mv);
      consumeDie(mv.die);
      appendLog(desc, 'npc');
      rerender(true);
      checkWin();
      if (state.phase === 'gameover') {
        finishGame();
        return;
      }
      setTimeout(playStep, SUB_STEP_MS);
    };
    playStep();
  }

  // -------------------- Spielende --------------------
  function finishGame() {
    rerender(false);
    const overlay = document.getElementById('overlay-win');
    const title = document.getElementById('win-title');
    const text = document.getElementById('win-text');
    if (state.winner === state.playerColor || state.opponent === 'local') {
      title.textContent = state.opponent === 'local'
        ? `${COLOR_DE[state.winner]} gewinnt!`
        : 'Sieg!';
    } else {
      title.textContent = 'Verloren';
    }
    const offCount = state.off[state.winner].length;
    const oppOff = state.off[state.winner === WHITE ? BLACK : WHITE].length;
    text.textContent = `Endstand: ${COLOR_DE[state.winner]} ${offCount} – ${COLOR_DE[state.winner === WHITE ? BLACK : WHITE]} ${oppOff} Steine ausgewürfelt.`;
    overlay.classList.remove('hidden');
  }

  // -------------------- Buttons --------------------
  elBtnRoll.addEventListener('click', () => {
    if (state.phase !== 'rolling' || isNpcTurn()) return;
    elDie1.classList.add('rolling');
    elDie2.classList.add('rolling');
    setTimeout(() => {
      rollDice();
      elDie1.classList.remove('rolling');
      elDie2.classList.remove('rolling');
      const msg = state.initialDice.length === 4
        ? `${COLOR_DE[state.current]} würfelt Pasch ${state.initialDice[0]}.`
        : `${COLOR_DE[state.current]} würfelt ${state.initialDice[0]} und ${state.initialDice[1]}.`;
      appendLog(msg, 'you');
      const moves = legalNextMoves(state, state.current);
      rerender(false);
      if (moves.length === 0) {
        appendLog('Kein Zug möglich.', 'system');
        setTimeout(() => {
          endTurn();
          rerender(false);
          scheduleNpcIfNeeded();
        }, 1000);
      }
    }, ROLL_MS);
  });

  elBtnPass.addEventListener('click', () => {
    if (isNpcTurn() || state.phase !== 'moving') return;
    endTurn();
    rerender(false);
    scheduleNpcIfNeeded();
  });

  elBtnUndo.addEventListener('click', () => {
    if (state.history.length === 0 || isNpcTurn()) return;
    state = state.history.pop();
    selectedFrom = null;
    // Letzten Log-Eintrag entfernen
    if (elLog.lastElementChild) elLog.lastElementChild.remove();
    rerender(true);
  });

  elBoard.addEventListener('click', onBoardClick);

  // -------------------- Start/Menü --------------------
  document.getElementById('btn-start').addEventListener('click', () => {
    const opts = {
      opponent: document.getElementById('opponent').value,
      playerColor: document.getElementById('player-color').value,
      autoConfirm: document.getElementById('auto-confirm').checked
    };
    state = newGame(opts);
    document.getElementById('screen-start').classList.add('hidden');
    document.getElementById('screen-game').classList.remove('hidden');
    elLog.innerHTML = '';
    appendLog('Neues Spiel begonnen. Weiß zieht zuerst.', 'system');
    buildBoardSkeleton();
    rerender(false);
    scheduleNpcIfNeeded();
  });

  document.getElementById('btn-back').addEventListener('click', () => {
    if (!confirm('Aktuelles Spiel verlassen?')) return;
    document.getElementById('screen-game').classList.add('hidden');
    document.getElementById('screen-start').classList.remove('hidden');
    document.getElementById('overlay-win').classList.add('hidden');
  });

  document.getElementById('btn-rematch').addEventListener('click', () => {
    document.getElementById('overlay-win').classList.add('hidden');
    const opts = {
      opponent: state.opponent,
      playerColor: state.playerColor,
      autoConfirm: state.autoConfirm
    };
    state = newGame(opts);
    elLog.innerHTML = '';
    appendLog('Neues Spiel begonnen. Weiß zieht zuerst.', 'system');
    rerender(false);
    scheduleNpcIfNeeded();
  });

  document.getElementById('btn-menu').addEventListener('click', () => {
    document.getElementById('overlay-win').classList.add('hidden');
    document.getElementById('screen-game').classList.add('hidden');
    document.getElementById('screen-start').classList.remove('hidden');
  });

  // -------------------- Nachtmodus --------------------
  const elBtnTheme = document.getElementById('btn-theme');
  function applyTheme(theme) {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      elBtnTheme.textContent = 'Tag';
      elBtnTheme.classList.add('active');
    } else {
      document.documentElement.classList.remove('dark');
      elBtnTheme.textContent = 'Nacht';
      elBtnTheme.classList.remove('active');
    }
    try { localStorage.setItem('bg.theme', theme); } catch (e) {}
  }
  let storedTheme = 'light';
  try { storedTheme = localStorage.getItem('bg.theme') || 'light'; } catch (e) {}
  applyTheme(storedTheme);
  elBtnTheme.addEventListener('click', () => {
    const isDark = document.documentElement.classList.contains('dark');
    applyTheme(isDark ? 'light' : 'dark');
  });

  // -------------------- Vollbild --------------------
  const elBtnFs = document.getElementById('btn-fullscreen');
  function updateFsLabel() {
    const isFs = !!document.fullscreenElement;
    elBtnFs.textContent = isFs ? 'Fenster' : 'Vollbild';
    elBtnFs.classList.toggle('active', isFs);
  }
  elBtnFs.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      const req = document.documentElement.requestFullscreen
        || document.documentElement.webkitRequestFullscreen;
      if (req) req.call(document.documentElement).catch(() => {});
    } else {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) exit.call(document).catch(() => {});
    }
  });
  document.addEventListener('fullscreenchange', updateFsLabel);
  document.addEventListener('webkitfullscreenchange', updateFsLabel);
  updateFsLabel();

})();
