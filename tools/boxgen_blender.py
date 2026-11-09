# Runs inside Blender (laptop). Sends building-art jobs to the garage box ComfyUI and saves raw PNGs.
import json, os, threading, time, urllib.request, urllib.parse
BASE = r"C:\Users\seanp\OneDrive\Desktop\GSD\WEBSITE\art"
HOST = "http://desktop-t903pbg:8188"
OUT = os.path.join(BASE, "raw"); os.makedirs(OUT, exist_ok=True)
LOG = os.path.join(BASE, "boxgen_log.txt")
def log(m):
    with open(LOG, "a") as f: f.write(time.strftime("%H:%M:%S ") + m + "\n")
def req(path, data=None):
    r = urllib.request.Request(HOST + path, data=json.dumps(data).encode() if data is not None else None,
                               headers={"Content-Type": "application/json"} if data is not None else {})
    with urllib.request.urlopen(r, timeout=60) as f: return f.read()
def wf(prompt, seed, key):
    return {"70": {"class_type": "UNETLoader", "inputs": {"unet_name": "flux-2-klein-4b-fp8.safetensors", "weight_dtype": "default"}},
            "71": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen_3_4b.safetensors", "type": "flux2", "device": "default"}},
            "72": {"class_type": "VAELoader", "inputs": {"vae_name": "flux2-vae.safetensors"}},
            "74": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["71", 0]}},
            "76": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["74", 0]}},
            "63": {"class_type": "CFGGuider", "inputs": {"model": ["70", 0], "positive": ["74", 0], "negative": ["76", 0], "cfg": 1.0}},
            "61": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}},
            "62": {"class_type": "Flux2Scheduler", "inputs": {"steps": 4, "width": 512, "height": 512}},
            "66": {"class_type": "EmptyFlux2LatentImage", "inputs": {"width": 512, "height": 512, "batch_size": 1}},
            "73": {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}},
            "64": {"class_type": "SamplerCustomAdvanced", "inputs": {"noise": ["73", 0], "guider": ["63", 0], "sampler": ["61", 0], "sigmas": ["62", 0], "latent_image": ["66", 0]}},
            "65": {"class_type": "VAEDecode", "inputs": {"samples": ["64", 0], "vae": ["72", 0]}},
            "9": {"class_type": "SaveImage", "inputs": {"images": ["65", 0], "filename_prefix": "gsdb_" + key}}}
def run():
    try:
        jobs = json.load(open(os.path.join(BASE, "jobs.json")))
        q = json.loads(req("/queue"))
        if q.get("queue_running"):
            req("/interrupt", {}); log("interrupted running job")
        ids = {}
        for n, (key, prompt) in enumerate(jobs):
            if os.path.exists(os.path.join(OUT, key + ".png")): continue
            r = json.loads(req("/prompt", {"prompt": wf(prompt, 1000 + n, key), "front": True}))
            ids[key] = r["prompt_id"]
        log("queued %d" % len(ids))
        while ids:
            time.sleep(4)
            for key, pid in list(ids.items()):
                h = json.loads(req("/history/" + pid)).get(pid)
                if not h: continue
                del ids[key]
                try:
                    im = h["outputs"]["9"]["images"][0]
                    data = req("/view?" + urllib.parse.urlencode({"filename": im["filename"], "subfolder": im["subfolder"], "type": im["type"]}))
                    open(os.path.join(OUT, key + ".png"), "wb").write(data); log("done " + key)
                except Exception as e: log("fail %s %s" % (key, e))
        log("FINISHED")
    except Exception as e: log("error %r" % e)
threading.Thread(target=run, daemon=True).start()
