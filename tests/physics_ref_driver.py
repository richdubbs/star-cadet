# tests/physics_ref_driver.py
# OWNER: PHYSICS (test support; not part of the app)
#
# Generates the numbers in tests/physics_ref_data.mjs from research/physics_ref_sim.py WITHOUT modifying that file.
#   python -I tests/physics_ref_driver.py research > ref.json      (then tests/physics_ref_data.mjs embeds the result)
#
# The reference port is loaded as a module; its random source is replaced by a constant 0.5 so that the lateral jitter term
# (0.5 - rand) * speed * 0.2 vanishes and the plunger boost jitter is a fixed +5 % (B = 1.05 * Boost).  Scenarios:
#   freefall  - empty table, ball dropped at (0, -13): samples every 0.25 s
#   launch    - ball resting on the plunger (settled for 3 s), plunger kicker live for 3 ticks at t = 3.0 with
#               'r05'   : B = 1.05 * boost              (what physics.js does with rand === 0.5)
#               'exact' : B = boost                      (rand === 0)
#               result = apex (minimum y) within 2.5 s after the kick
#   flipper   - ball dropped from rest at (1.9, 9.0); left flipper pressed at tick K; result = speed and x when the ball first
#               rises above y = 10.0 after having been below y = 11.0 (the speed it leaves the flipper with)
import sys, os, json, math, importlib.util

research = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else 'research')
os.chdir(research)          # physics_ref_sim.py opens 'physics_data.json' relative to the cwd
DT = 1 / 120


class Const:
    def random(self):
        return 0.5


def load():
    spec = importlib.util.spec_from_file_location('ref', os.path.join(research, 'physics_ref_sim.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def new_ball(m, x, y):
    b = m.Ball()
    b.p = (x, y)
    b.d = (0.0, 0.0)
    b.s = 0.0
    b.dead = False
    return b


out = {}

# ---- free fall --------------------------------------------------------------------------------------------------------------
m = load()
m.edges.clear()
m.flips.clear()
b = new_ball(m, 0.0, -13.0)
rng = Const()
samples = []
for i in range(int(3.0 / DT)):
    m.tick(b, DT, rng)
    if (i + 1) % 30 == 0:
        samples.append([round((i + 1) * DT, 4), round(b.p[1], 4), round(b.s, 4)])
out['freefall'] = samples


# ---- plunger launches -------------------------------------------------------------------------------------------------------
def launch_run(boost_param, fire_t=3.0, T=5.5):
    m = load()
    rng = Const()
    b = new_ball(m, -7.020939, 10.084854)
    m.plunger['boost'] = 0.0
    m.plunger['thr'] = 1e9
    fired = False
    tfire = 0
    post = []
    for i in range(int(T / DT)):
        t = i * DT
        if t >= fire_t - 1e-9 and not fired:
            m.plunger['boost'] = boost_param
            m.plunger['thr'] = 0.0
            fired = True
            tfire = t
        if fired and t >= tfire + 0.025 - 1e-9:
            m.plunger['boost'] = 0.0
            m.plunger['thr'] = 1e9
        m.tick(b, DT, rng)
        if t >= fire_t - 1e-9:
            post.append(b.p[1])
        if b.dead:
            break
    return min(post[:int(2.5 / DT)])


out['launch'] = {}
for boost in (10, 15, 20, 22, 24, 26, 28, 30, 100):
    out['launch'][str(boost)] = {
        'r05': round(launch_run(float(boost)), 4),
        'exact': round(launch_run(boost / 1.05), 4),
    }


# ---- flipper shots ----------------------------------------------------------------------------------------------------------
def flipper_run(press_tick, T=2.5):
    m = load()
    rng = Const()
    b = new_ball(m, 1.9, 9.0)
    seen_low = False
    for i in range(int(T / DT)):
        if i == press_tick:
            m.set_motion(m.flips[0], 'extend')
        m.tick(b, DT, rng)
        if b.p[1] > 11.0:
            seen_low = True
        if seen_low and b.p[1] < 10.0:
            return [press_tick, round(b.s, 4), round(b.p[0], 4)]
        if b.dead:
            break
    return [press_tick, None, None]


out['flipper'] = [flipper_run(k) for k in (0, 30, 56, 60, 64, 66, 68, 70, 72, 74, 76, 78, 80, 82, 84, 86, 88, 90)]
print(json.dumps(out))
