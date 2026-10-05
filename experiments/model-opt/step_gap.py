import json,sys,glob,os,statistics as st
# Median and p90 seconds between consecutive assistant_start events, over all tasks of a run folder.
for d in sys.argv[1:]:
    gaps=[];steps_pass=[]
    for f in sorted(glob.glob(os.path.join(d,'*.events.jsonl'))):
        ts=[]
        for line in open(f):
            try: e=json.loads(line)
            except: continue
            if e.get('event',{}).get('type')=='assistant_start': ts.append(e['t'])
        gaps+= [(b-a)/1000 for a,b in zip(ts,ts[1:])]
    gaps.sort()
    p90=gaps[int(0.9*(len(gaps)-1))] if gaps else 0
    j=d.rstrip('/')+'.json'
    rows=json.load(open(j))['rows'] if os.path.exists(j) else []
    ps=[r for r in rows if r.get('success')]
    print(f"{os.path.basename(d.rstrip('/'))}: n={len(gaps)} median={st.median(gaps):.1f} p90={p90:.1f} pass={len(ps)}/{len(rows)}")
