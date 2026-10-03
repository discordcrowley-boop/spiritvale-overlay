const { EventEmitter } = require("events");



/**

 * Overlay combat session model.

 * Demo mode synthesizes a party fight.

 * Live mode applies snapshots from the Bun/Npcap capture bridge.

 */

class OverlayEngine extends EventEmitter {

  constructor() {

    super();

    this.running = false;

    this.mode = "idle"; // idle | demo | live

    this.startedAt = null;

    this.actors = new Map();

    this.events = [];

    this.demoTimer = null;

    this.tickTimer = null;

    this.liveExtras = {

      buffs: [],

      farm: null,

      pets: [],

      casts: [],

      boss: [],

      tower: null,

      capture: null,

      recentDeaths: [],

    };

    this.liveTotals = {

      totalDamage: 0,

      totalHealing: 0,

      totalTaken: 0,

      totalDps: 0,

      totalHps: 0,

      elapsedMs: 0,

    };

  }



  getSnapshot() {

    if (this.mode === "live" && this.running) {

      const elapsedMs = this.liveTotals.elapsedMs || (this.startedAt ? Date.now() - this.startedAt : 0);

      const elapsedSec = Math.max(0.001, elapsedMs / 1000);

      const actors = [...this.actors.values()]
        .map((actor) => ({
          ...actor,
          skills: Array.isArray(actor.skills)
            ? actor.skills
            : Object.entries(actor.skills || {})
                .map(([id, row]) => ({ id, ...row }))
                .sort((a, b) => (b.damage || 0) - (a.damage || 0))
                .slice(0, 12),
          healingSkills: Array.isArray(actor.healingSkills) ? actor.healingSkills : [],
          takenSkills: Array.isArray(actor.takenSkills) ? actor.takenSkills : [],
        }))
        .sort((a, b) => b.damage - a.damage);


      return {

        running: this.running,

        mode: this.mode,

        startedAt: this.startedAt,

        elapsedMs,

        elapsedSec,

        totalDamage: this.liveTotals.totalDamage,

        totalHealing: this.liveTotals.totalHealing,

        totalTaken: this.liveTotals.totalTaken,

        totalDps: this.liveTotals.totalDps,

        totalHps: this.liveTotals.totalHps,

        actors,

        recentDeaths: this.liveExtras.recentDeaths || [],

        buffs: this.liveExtras.buffs || [],

        farm: this.liveExtras.farm,

        pets: this.liveExtras.pets || [],

        casts: this.liveExtras.casts || [],

        boss: this.liveExtras.boss || [],
        bossMeter: this.liveExtras.bossMeter || null,

        tower: this.liveExtras.tower,

        capture: this.liveExtras.capture,

      };

    }



    const elapsedMs = this.startedAt ? Date.now() - this.startedAt : 0;

    const elapsedSec = Math.max(0.001, elapsedMs / 1000);

    const actors = [...this.actors.values()]

      .map((actor) => {

        const dps = actor.damage / elapsedSec;

        const hps = actor.healing / elapsedSec;

        const taken = actor.taken / elapsedSec;

        return {

          ...actor,

          dps,

          hps,

          takenDps: taken,

          skills: Object.entries(actor.skills)

            .map(([id, row]) => ({ id, ...row }))

                .sort((a, b) => b.damage - a.damage)

                .slice(0, 12),

          healingSkills: [],

          takenSkills: [],

        };

      })

      .sort((a, b) => b.damage - a.damage);



    const totalDamage = actors.reduce((sum, row) => sum + row.damage, 0);

    const totalHealing = actors.reduce((sum, row) => sum + row.healing, 0);

    const totalTaken = actors.reduce((sum, row) => sum + row.taken, 0);



    return {

      running: this.running,

      mode: this.mode,

      startedAt: this.startedAt,

      elapsedMs,

      elapsedSec,

      totalDamage,

      totalHealing,

      totalTaken,

      totalDps: totalDamage / elapsedSec,

      totalHps: totalHealing / elapsedSec,

      actors,

      recentDeaths: this.events

        .filter((row) => row.type === "death")

        .slice(-12)

        .reverse(),

      buffs: [],

      farm: null,

      casts: [],

      boss: [],

      tower: null,

      capture: null,

    };

  }



  applyLiveSnapshot(snap) {

    if (!this.running || this.mode !== "live" || !snap) return this.getSnapshot();

    this.startedAt = snap.startedAt || this.startedAt || Date.now();

    this.liveTotals = {

      totalDamage: snap.totalDamage || 0,

      totalHealing: snap.totalHealing || 0,

      totalTaken: snap.totalTaken || 0,

      totalDps: snap.totalDps || 0,

      totalHps: snap.totalHps || 0,

      elapsedMs: snap.elapsedMs || 0,

    };

    this.liveExtras = {

      buffs: snap.buffs || [],

      farm: snap.farm || null,

      pets: Array.isArray(snap.pets) ? snap.pets : [],

      casts: snap.casts || [],

      boss: snap.boss || [],
      bossMeter: snap.bossMeter || null,

      tower: snap.tower || null,

      capture: snap.capture || null,

      recentDeaths: snap.recentDeaths || [],

    };

    this.actors.clear();

    for (const row of snap.actors || []) {

      this.actors.set(row.id || row.name, {

        id: row.id || row.name,

        name: row.name,

        className: row.className || "Player",

        classIconUrl: row.classIconUrl || null,

        classIconUrls: Array.isArray(row.classIconUrls) ? row.classIconUrls : [],

        color: row.color || "#3ee0b0",

        damage: row.damage || 0,

        healing: row.healing || 0,

        taken: row.taken || 0,

        dps: row.dps || 0,

        hps: row.hps || 0,

        takenDps: row.takenDps || 0,

        hits: row.hits || 0,

        crits: row.crits || 0,

        skills: Array.isArray(row.skills)
          ? row.skills
          : Object.entries(row.skills || {}).map(([id, skill]) => ({
              id,
              name: skill.name,
              damage: skill.damage || 0,
              hits: skill.hits || 0,
              iconUrl: skill.iconUrl || null,
            })),
        healingSkills: Array.isArray(row.healingSkills) ? row.healingSkills : [],
        takenSkills: Array.isArray(row.takenSkills) ? row.takenSkills : [],
        bossDamage: row.bossDamage || 0,
        bossDps: row.bossDps || 0,
        bossSkills: Array.isArray(row.bossSkills) ? row.bossSkills : [],

      });

    }

    const out = this.getSnapshot();

    this.emit("tick", out);

    return out;

  }



  ensureActor(id, patch = {}) {

    if (!this.actors.has(id)) {

      this.actors.set(id, {

        id,

        name: patch.name || id,

        className: patch.className || "Unknown",

        classIconUrl:
          patch.classIconUrl ||
          (patch.className
            ? `https://spiritvalers.com/content/game/icons/class-${String(patch.className)
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-+|-+$/g, "")}.webp`
            : null),

        color: patch.color || "#3ee0b0",

        damage: 0,

        healing: 0,

        taken: 0,

        hits: 0,

        crits: 0,

        skills: {},

      });

    }

    const actor = this.actors.get(id);

    Object.assign(actor, patch);

    return actor;

  }



  recordDamage(payload) {

    if (!this.running) return;

    const actor = this.ensureActor(payload.actorId, {

      name: payload.actorName,

      className: payload.className,

      color: payload.color,

    });

    const amount = Math.max(0, Number(payload.amount) || 0);

    actor.damage += amount;

    actor.hits += 1;

    if (payload.crit) actor.crits += 1;

    const skillId = payload.skillId || payload.skillName || "auto";

    if (!actor.skills[skillId]) {

      actor.skills[skillId] = {

        name: payload.skillName || skillId,

        damage: 0,

        hits: 0,

      };

    }

    actor.skills[skillId].damage += amount;

    actor.skills[skillId].hits += 1;

    this.events.push({

      type: "damage",

      at: Date.now(),

      ...payload,

      amount,

    });

    if (this.events.length > 5000) this.events.splice(0, this.events.length - 5000);

  }



  recordHeal(payload) {

    if (!this.running) return;

    const actor = this.ensureActor(payload.actorId, {

      name: payload.actorName,

      className: payload.className,

      color: payload.color,

    });

    const amount = Math.max(0, Number(payload.amount) || 0);

    actor.healing += amount;

    this.events.push({ type: "heal", at: Date.now(), ...payload, amount });

  }



  recordTaken(payload) {

    if (!this.running) return;

    const actor = this.ensureActor(payload.actorId, {

      name: payload.actorName,

      className: payload.className,

      color: payload.color,

    });

    const amount = Math.max(0, Number(payload.amount) || 0);

    actor.taken += amount;

    this.events.push({ type: "taken", at: Date.now(), ...payload, amount });

  }



  recordDeath(payload) {

    if (!this.running) return;

    this.events.push({

      type: "death",

      at: Date.now(),

      actorId: payload.actorId,

      actorName: payload.actorName,

      source: payload.source || "Unknown",

      skillName: payload.skillName || "Fatal",

      amount: Number(payload.amount) || 0,

    });

  }



  start(mode = "demo") {

    this.stop();

    this.running = true;

    this.mode = mode;

    this.startedAt = Date.now();

    this.actors.clear();

    this.events = [];

    this.liveExtras = {

      buffs: [],

      farm: null,

      pets: [],

      casts: [],

      boss: [],

      tower: null,

      capture: null,

      recentDeaths: [],

    };

    this.liveTotals = {

      totalDamage: 0,

      totalHealing: 0,

      totalTaken: 0,

      totalDps: 0,

      totalHps: 0,

      elapsedMs: 0,

    };

    this.emit("status", this.getSnapshot());



    this.tickTimer = setInterval(() => {

      this.emit("tick", this.getSnapshot());

    }, 200);



    if (mode === "demo") {

      this.#seedDemoParty();

      this.demoTimer = setInterval(() => this.#demoPulse(), 350);

    }



    return this.getSnapshot();

  }



  resetEncounter() {

    if (!this.running) return this.getSnapshot();

    if (this.mode === "live") {

      this.actors.clear();

      this.events = [];

      this.liveExtras = {

        buffs: [],

        farm: this.liveExtras.farm

          ? {

              ...this.liveExtras.farm,

              xp: 0,

              jobXp: 0,

              gold: 0,

              xpPerHour: 0,

              jobXpPerHour: 0,

              goldPerHour: 0,

              kills: 0,

              drops: [],

              mobs: [],

              inventoryGold: this.liveExtras.farm.inventoryGold ?? null,

              bagWeight: null,

              bagWeightMax: null,

              ttlMs: null,

              xpToLevel: null,

              xpPercent: null,

            }

          : null,

        pets: [],

        casts: [],

        boss: [],

        tower: this.liveExtras.tower,

        capture: this.liveExtras.capture,

        recentDeaths: [],

      };

      this.liveTotals = {

        totalDamage: 0,

        totalHealing: 0,

        totalTaken: 0,

        totalDps: 0,

        totalHps: 0,

        elapsedMs: 0,

      };

      this.startedAt = Date.now();

      const snap = this.getSnapshot();

      this.emit("tick", snap);

      return snap;

    }

    const mode = this.mode;

    return this.start(mode);

  }


  /** Soft-zero combat totals without wiping capture identity / live extras. */
  zeroMeters() {

    if (!this.running) return this.getSnapshot();

    if (this.mode === "live") {

      for (const actor of this.actors.values()) {

        actor.damage = 0;

        actor.healing = 0;

        actor.taken = 0;

        actor.dps = 0;

        actor.hps = 0;

        actor.takenDps = 0;

        actor.currentDps = 0;

        actor.hits = 0;

        actor.crits = 0;

        actor.skills = [];

        actor.healingSkills = [];

        actor.takenSkills = [];

      }

      this.events = [];

      this.liveTotals = {

        totalDamage: 0,

        totalHealing: 0,

        totalTaken: 0,

        totalDps: 0,

        totalHps: 0,

        elapsedMs: 0,

      };

      this.liveExtras = {

        ...this.liveExtras,

        casts: [],

        boss: [],

        recentDeaths: [],

      };

      this.startedAt = Date.now();

      const snap = this.getSnapshot();

      this.emit("tick", snap);

      return snap;

    }

    return this.getSnapshot();

  }


  stop() {

    this.running = false;

    this.mode = "idle";

    if (this.demoTimer) clearInterval(this.demoTimer);

    if (this.tickTimer) clearInterval(this.tickTimer);

    this.demoTimer = null;

    this.tickTimer = null;

    const snap = this.getSnapshot();

    this.emit("status", snap);

    return snap;

  }



  #seedDemoParty() {

    const party = [

      { id: "wiz", name: "Wizard", className: "Wizard", color: "#6dffb0" },

      { id: "shin", name: "Shinobi", className: "Shinobi", color: "#5fd0ff" },

      { id: "necro", name: "Necromancer", className: "Necromancer", color: "#3aa89a" },

      { id: "priest", name: "Priest", className: "Priest", color: "#ffd27a" },

      { id: "you", name: "You", className: "Gunslinger", color: "#e0c36a" },

    ];

    for (const row of party) this.ensureActor(row.id, row);

  }



  #demoPulse() {

    const kits = {

      wiz: [

        ["blizzard", "Blizzard", 18000, 28000],

        ["tempest", "Tempest", 12000, 22000],

        ["meteor", "Meteor", 9000, 16000],

      ],

      shin: [

        ["flash", "Flash Step", 14000, 21000],

        ["blade", "Blade Dance", 10000, 18000],

        ["shadow", "Shadow Step", 7000, 14000],

      ],

      necro: [

        ["bone", "Bone Spear", 9000, 15000],

        ["coil", "Death Coil", 6000, 12000],

        ["decay", "Decay", 4000, 9000],

      ],

      priest: [

        ["smite", "Smite", 7000, 12000],

        ["divine", "Divine Punishment", 4500, 9000],

        ["auto", "Basic", 1500, 3500],

      ],

      you: [

        ["suppress", "Suppressing Shot", 11000, 19000],

        ["chain", "Chain Reaction", 8000, 15000],

        ["flow", "Skirmisher's Flow", 5000, 11000],

      ],

    };



    for (const [actorId, skills] of Object.entries(kits)) {

      const pick = skills[Math.floor(Math.random() * skills.length)];

      const [skillId, skillName, lo, hi] = pick;

      const amount = lo + Math.floor(Math.random() * (hi - lo));

      const crit = Math.random() < 0.22;

      this.recordDamage({

        actorId,

        actorName: this.actors.get(actorId)?.name,

        className: this.actors.get(actorId)?.className,

        color: this.actors.get(actorId)?.color,

        skillId,

        skillName,

        amount: crit ? Math.round(amount * 1.45) : amount,

        crit,

      });

      if (actorId === "priest" && Math.random() < 0.35) {

        this.recordHeal({

          actorId,

          actorName: "Priest",

          className: "Priest",

          color: "#ffd27a",

          skillName: "Heal",

          amount: 4000 + Math.floor(Math.random() * 6000),

        });

      }

      if (Math.random() < 0.25) {

        this.recordTaken({

          actorId,

          actorName: this.actors.get(actorId)?.name,

          className: this.actors.get(actorId)?.className,

          color: this.actors.get(actorId)?.color,

          skillName: "Enemy Hit",

          amount: 800 + Math.floor(Math.random() * 2400),

        });

      }

    }



    if (Math.random() < 0.02) {

      this.recordDeath({

        actorId: "you",

        actorName: "You",

        source: "Flame Drake",

        skillName: "Firewall",

        amount: 1200 + Math.floor(Math.random() * 800),

      });

    }

  }

}



module.exports = { OverlayEngine };


