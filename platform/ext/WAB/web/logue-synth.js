// KORG prologue / minilogue_xd user osc/fx container
// Jari Kleimola 2019-20 (jari@webaudiomodules.org)

var KORG = KORG || {}

var oscDefs = [
  // -- WASM example
  { label:"WASM pd", man:"test", type:"pd", code:"pd.js" },

  // -- KORG
  { label:"KORG fm",      man:"KORG", type:"fm",      code:"fm.js" },
  { label:"KORG waves",   man:"KORG", type:"waves",   code:"waves.js" },

  // -- Mutable Instruments
  { label:"PLAITS add", man:"MI", type:"MO2_ADD", code:"plaits-add.js" },
  { label:"PLAITS fm",  man:"MI", type:"MO2_FM",  code:"plaits-fm.js"  },
  { label:"PLAITS grn", man:"MI", type:"MO2_GRN", code:"plaits-grn.js" },
  { label:"PLAITS wsh", man:"MI", type:"MO2_WSH", code:"plaits-wsh.js" },
  { label:"PLAITS va",  man:"MI", type:"MO2_VA",  code:"plaits-va.js"  },
  { label:"PLAITS wta", man:"MI", type:"MO2_WTA", code:"plaits-wta.js" },
  { label:"PLAITS wtb", man:"MI", type:"MO2_WTB", code:"plaits-wtb.js" },
  { label:"PLAITS wtc", man:"MI", type:"MO2_WTC", code:"plaits-wtc.js" },
  { label:"PLAITS wtd", man:"MI", type:"MO2_WTD", code:"plaits-wtd.js" },
  { label:"PLAITS wte", man:"MI", type:"MO2_WTE", code:"plaits-wte.js" },
  { label:"PLAITS wtf", man:"MI", type:"MO2_WTF", code:"plaits-wtf.js" },

  // -- Jari
  { label:"JARI vps", man:"JARI", type:"vps", code:"vps.js" },
];

oscDefs.url = "oscs/";

KORG.LogueSynth = class LogueSynth extends WAB.MonoSynth
{
    async init (options) {
        await super.init();

        options.overlay = options.overlay === undefined ? true : options.overlay;
        options.hold = options.hold === undefined ? true : options.hold;
        options.pitch = options.pitch === undefined ? 60 : options.pitch;
        options.freqRange = options.freqRange === undefined ? 5 : options.freqRange;
        options.outLevel = options.outLevel === undefined ? 0.2 : options.outLevel;
        options.oscillator = options.oscillator === undefined ? "fm" : options.oscillator;

        this.gui = new LogueGUI(this);
        await this.gui.init(options);

        // -- processor part lives in AudioWorklet's audio thread
        // -- the line below loads its script into AudioWorkletGlobalScope
        // -- instantiated in setOscType
        await actx.audioWorklet.addModule("libs/wab-processor.js");
        await actx.audioWorklet.addModule("oscs/logue-proc.js");

        let type = window.location.hash ? window.location.hash.substring(1) : options.oscillator;
        await this.setOscType(type);
        this.hold  = options.hold;
        this.pitch = options.pitch;
        this.gate  = options.hold ? 1 : 0;
        this.masterGain = Math.max(0, Math.min(options.outLevel,1));
    }

    // -- oscillator hotswap
    //
    async setOscType (type) {
        this.lfoAmount = 0;
        for (let i = 0; i < oscDefs.length; i++) {
            if (oscDefs[i].type == type) {

                let def = oscDefs[i];
                let url = oscDefs.url;
                if (def.man != "") url += def.man + "/"

                // -- create oscillator
                let osc = new KORG.LogueOsc(actx);
                await osc.load(url + def.code, def.waves);

                // -- setup gui knobs and insert osc into audio graph
                // -- finally, sets the defaults (unavailable in hw though)
                let manifest = await osc.getManifest();
                this.gui.reset(manifest);
                this.oscillator = osc;
                this.gui.setDefaults(manifest);

                this.type = type;
                break;
            }
        }
    }

    reload (kind) {
        if (kind == "osc") this.setOscType(this.type);
    }
}
