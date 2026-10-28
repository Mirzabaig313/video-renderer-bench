"""Recipe library for the ManimGX spike: our code, not the model's.

`World` builds every mobject once and exposes the closed set of recipes the translator may
call (writeTitle, indicate, dockTitle, buildPipeline, streamMessages, crash, zoomAndOpen,
codeHighlight, redeliver, recap). Discrete beats are ManimGX animations (Write, Create,
Transform, TransformMatchingShapes, camera frame moves). Continuous state (message cards,
queue trays, counters, shards, dust, captions) is a pure function of `scene.time` read in
plain per-frame updaters, so any frame depends only on its time (determinism, FR2-009-style
"no frozen stretch" motion) -- the same contract as the Remotion prototype's frame-pure sim.
"""

from __future__ import annotations

import json
import math
import random
from pathlib import Path
import manimgx as m
from manimgx.mobject import flow

ROOT = Path(__file__).resolve().parent
REMOTION_PUBLIC = ROOT.parent / "remotion" / "public"

# Theme: same concept colours as remotion/src/theme.ts.
BG = "#070b18"
INK = "#e8edf7"
MUTED = "#8a97b3"
BROKER = "#4f8cff"
PRODUCER = "#a78bfa"
CONSUMER = "#cbd5e1"
AMBER = "#ffb547"
RED = "#ff4d5e"
GREEN = "#34d399"
CODE_BG = "#0d1326"
SANS = "Avenir Next"
MONO = "Menlo"

m.config.background_color = BG

BASE_W = 14.0 * 16 / 9 * 8 / 14  # frame width at scale 1 (16:9, 8 units high)
P_POS = (-4.3, -0.15, 0.0)
B_POS = (0.0, -0.15, 0.0)
C_POS = (4.3, -0.15, 0.0)


def smooth01(x: float) -> float:
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def ease_out(x: float) -> float:
    x = min(1.0, max(0.0, x))
    return 1 - (1 - x) ** 3


def grid_png() -> Path:
    """Faint 1-unit grid as one image (lines would each be checked by `inspect` as text overlaps)."""
    from PIL import Image, ImageDraw

    path = ROOT / "generated" / "grid.png"
    if not path.exists():
        px = 54  # pixels per unit; image covers 32 x 20 units
        img = Image.new("RGBA", (32 * px, 20 * px), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        for x in range(0, 32 * px + 1, px):
            d.line([(x, 0), (x, 20 * px)], fill=(148, 163, 184, 16), width=1)
        for y in range(0, 20 * px + 1, px):
            d.line([(0, y), (32 * px, y)], fill=(148, 163, 184, 16), width=1)
        img.save(path)
    return path


class Fader:
    """Set a group's opacity as a multiple of the opacities it was built with."""

    def __init__(self, mob: m.Mobject) -> None:
        self.mob = mob
        self.base = [(s, s.get_fill_opacity(), s.get_stroke_opacity()) for s in mob.get_family()]
        self.alpha = -1.0

    def set(self, a: float) -> None:
        a = round(a, 3)
        if a == self.alpha:
            return
        self.alpha = a
        for s, f, st in self.base:
            s.set_fill(opacity=f * a, family=False)
            s.set_stroke(opacity=st * a, family=False)


def glow(shape: m.VMobject, color: str, strength: float = 1.0) -> m.VGroup:
    """Soft glow: copies of the outline, wider and fainter outward (2D has no bloom pass)."""
    layers = m.VGroup()
    for width, opacity in ((30, 0.035), (20, 0.06), (12, 0.1), (6, 0.18)):
        c = shape.copy().set_fill(opacity=0).set_stroke(color, width=width, opacity=opacity * strength)
        layers.add(c)
    return layers


def halo(center: tuple[float, float, float], radius: float, color: str, strength: float = 1.0) -> m.VGroup:
    return m.VGroup(*(
        m.Circle(radius=radius * k, stroke_width=0).set_fill(color, opacity=0.035 * strength).move_to(center)
        for k in (1.0, 0.8, 0.62, 0.45)
    ))


def label(text: str, pos: tuple[float, float, float], color: str = INK, size: int = 24) -> m.Text:
    return m.Text(text, font=SANS, weight=m.BOLD, font_size=size, color=color).move_to(pos)


class Node(m.VGroup):
    def __init__(self, body: m.VMobject, details: m.VGroup, name: str, color: str, glow_k: float = 1.0) -> None:
        self.halo = halo(tuple(body.get_center()), body.width * 1.25, color, glow_k)
        self.glow = glow(body, color, glow_k)
        self.body = body
        self.details = details
        self.tag = label(name, tuple(body.get_bottom() + 0.33 * m.DOWN))
        super().__init__(self.halo, self.glow, body, details, self.tag)


def make_producer() -> Node:
    body = m.RoundedRectangle(corner_radius=0.14, width=1.15, height=1.55, stroke_color=PRODUCER, stroke_width=3)
    body.set_fill("#120f2a", opacity=0.95).move_to(P_POS)
    rows = m.VGroup()
    for k in range(4):
        y = 0.52 - k * 0.34
        row = m.RoundedRectangle(corner_radius=0.04, width=0.86, height=0.22, stroke_color=PRODUCER, stroke_width=1.5)
        row.set_stroke(opacity=0.55).set_fill(PRODUCER, opacity=0.06).move_to(body.get_center() + [0, y, 0])
        vents = m.VGroup(*(m.Line([-0.33 + i * 0.07, -0.05, 0], [-0.33 + i * 0.07, 0.05, 0], stroke_width=1.5,
                                  color=PRODUCER).set_stroke(opacity=0.5) for i in range(5)))
        vents.move_to(row.get_center() + [-0.12, 0, 0])
        leds = m.VGroup(m.Dot(radius=0.025, color=GREEN), m.Dot(radius=0.025, color=PRODUCER)).arrange(m.RIGHT, buff=0.06)
        leds.move_to(row.get_center() + [0.3, 0, 0])
        rows.add(m.VGroup(row, vents, leds))
    return Node(body, rows, "Producer", PRODUCER, 0.9)


def make_broker() -> Node:
    body = m.RoundedRectangle(corner_radius=0.16, width=1.4, height=1.95, stroke_color=BROKER, stroke_width=3.5)
    body.set_fill("#0b1736", opacity=0.97).move_to(B_POS)
    top = body.get_top()
    dots = m.VGroup(*(m.Dot(radius=0.025, color=BROKER) for _ in range(3))).arrange(m.RIGHT, buff=0.05)
    dots.move_to(top + [-0.45, -0.15, 0])
    bar = m.Line(top + [-0.6, -0.3, 0], top + [0.6, -0.3, 0], stroke_width=1.2, color=BROKER).set_stroke(opacity=0.5)
    trays = m.VGroup()
    for k in range(5):
        tray = m.RoundedRectangle(corner_radius=0.04, width=1.05, height=0.2, stroke_color=BROKER, stroke_width=1.5)
        tray.set_fill(BROKER, opacity=0.06).move_to(body.get_bottom() + [0, 0.25 + k * 0.29, 0])
        trays.add(tray)
    node = Node(body, m.VGroup(dots, bar, trays), "Broker", BROKER, 1.3)
    node.trays = trays  # type: ignore[attr-defined]
    return node


def gear(center: tuple[float, float, float], r: float, color: str) -> m.VGroup:
    pts = []
    teeth = 8
    for k in range(teeth * 4):
        a = 2 * math.pi * k / (teeth * 4)
        rr = r if (k % 4) in (0, 1) else r * 0.78
        pts.append([center[0] + rr * math.cos(a), center[1] + rr * math.sin(a), 0])
    g = m.Polygon(*pts, stroke_color=color, stroke_width=2.5).set_fill(opacity=0)
    hub = m.Circle(radius=r * 0.36, stroke_color=color, stroke_width=2.5).move_to(center)
    return m.VGroup(g, hub)


def make_consumer() -> Node:
    body = m.RoundedRectangle(corner_radius=0.14, width=1.2, height=1.4, stroke_color=CONSUMER, stroke_width=3)
    body.set_fill("#0f1424", opacity=0.97).move_to(C_POS)
    c = body.get_center()
    screen = m.RoundedRectangle(corner_radius=0.05, width=0.9, height=0.36, stroke_color=CONSUMER, stroke_width=1.5)
    screen.set_fill(CONSUMER, opacity=0.08).move_to(c + [0, 0.4, 0])
    lines = m.VGroup(*(m.Line(c + [-0.32, 0.47 - i * 0.08, 0], c + [-0.32 + w, 0.47 - i * 0.08, 0], stroke_width=2.5,
                              color=CONSUMER) for i, w in enumerate((0.5, 0.36, 0.44))))
    g = gear((c[0], c[1] - 0.2, 0), 0.27, CONSUMER)
    node = Node(body, m.VGroup(screen, lines, g), "Consumer", CONSUMER, 0.6)
    node.gear = g  # type: ignore[attr-defined]
    return node


def pipe(a: tuple[float, float, float], b: tuple[float, float, float]) -> m.CubicBezier:
    dx = b[0] - a[0]
    return m.CubicBezier(a, (a[0] + dx * 0.33, a[1] + 0.55, 0), (a[0] + dx * 0.66, b[1] - 0.55, 0), b,
                         stroke_color="#56689e", stroke_width=3)


def message_card(text: str, w: float, h: float, size: int) -> m.VGroup:
    box = m.RoundedRectangle(corner_radius=min(0.08, h / 3), width=w, height=h, stroke_color=INK, stroke_width=1.6)
    box.set_fill(CODE_BG, opacity=0.95)
    t = m.Text(text, font=MONO, font_size=size, color=INK)
    if t.width > w * 0.84:
        t.scale(w * 0.84 / t.width)
    t.move_to(box)
    return m.VGroup(box, t)


class World:
    def __init__(self, scene: m.Scene, captions: bool = True) -> None:
        self.s = scene
        self.plan = json.loads((ROOT / "generated" / "plan.json").read_text())
        self.fps = self.plan["fps"]
        self.cue = {k: v["frame"] for k, v in self.plan["cues"].items()}
        self.sim = self.plan["sim"]
        self.frame = scene.camera.frame
        self.pins: list[tuple[m.Mobject, tuple[float, float], float]] = []
        self._build_background()
        self._build_title()
        self._build_pipeline()
        self._build_messages()
        self._build_detail()
        self._build_code()
        self._build_recap()
        self._build_hud(captions)
        self._build_crash_fx()

    # ---------- time helpers ----------
    def f(self) -> float:
        """Current time in storyboard frames (30 fps clock, fractional at 60 fps)."""
        return self.s.time * self.fps

    def at(self, t: float) -> None:
        dt = t - self.s.time
        if dt > 1e-9:
            self.s.wait(dt)

    def narrate(self, audio: str, t: float) -> None:
        self.s.add_sound(str(REMOTION_PUBLIC / audio), time_offset=t - self.s.time)

    def beat(self, items: list[tuple[str, str, float, float]]) -> None:
        anims = []
        for recipe, cue, delay, dur in items:
            parts = getattr(self, "r_" + recipe)(cue)
            group = m.AnimationGroup(*parts, run_time=dur)
            anims.append(m.Succession(m.Wait(run_time=delay), group) if delay > 0 else group)
        self.s.play(*anims)

    # ---------- HUD: mobjects pinned to the screen while the camera moves ----------
    def pin(self, mob: m.Mobject) -> None:
        fw = self.frame.width
        fc = self.frame.get_center()
        s = fw / BASE_W
        rel = (mob.get_center() - fc) / s
        self.pins.append((mob, (float(rel[0]), float(rel[1])), mob.height / s))

        def place(mm: m.Mobject, rel=rel, h=mob.height / s) -> None:
            k = self.frame.width / BASE_W
            if mm.height > 1e-6:
                mm.scale(k * h / mm.height)
            mm.move_to(self.frame.get_center() + k * rel)

        mob.add_updater(place)

    def unpin(self, mob: m.Mobject) -> None:
        mob.clear_updaters()

    # ---------- builders ----------
    def _build_background(self) -> None:
        grid = m.ImageMobject(str(grid_png())).set(width=32).move_to(m.ORIGIN)
        rng = random.Random(7)
        dust = m.VGroup()
        params = []
        for _ in range(70):
            d = m.Dot(radius=0.008 + rng.random() * 0.022, color="#c7d2fe")
            params.append((rng.uniform(-9, 9), rng.uniform(-5.5, 5.5), 0.02 + rng.random() * 0.07,
                           0.25 + rng.random() * 0.5, rng.random() * 6.28, 0.3 + rng.random() * 0.7))
            dust.add(d)

        def drift(g: m.Mobject) -> None:
            t = self.s.time
            for d, (x0, y0, sp, tw, ph, o) in zip(g.submobjects, params, strict=True):
                x = (x0 + 9 + t * sp * 0.6) % 18 - 9
                y = (y0 + 5.5 + t * sp) % 11 - 5.5
                d.move_to([x, y, 0])
                d.set_fill(opacity=o * (0.25 + 0.35 * (0.5 + 0.5 * math.sin(t * tw * 3 + ph))))

        dust.add_updater(drift)
        self.s.add(grid, dust)

    def _build_title(self) -> None:
        t = lambda s, c=INK: m.Text(s, font=SANS, weight=m.BOLD, font_size=66, color=c)  # noqa: E731
        self.crash_word = t("crashes?", RED)
        line2 = m.VGroup(t("if the consumer"), self.crash_word).arrange(m.RIGHT, buff=0.3, aligned_edge=m.DOWN)
        self.title = m.VGroup(t("What happens to a message"), line2).arrange(m.DOWN, buff=0.28).move_to([0, 0.75, 0])
        self.underline = m.Line([-0.75, 0, 0], [0.75, 0, 0], stroke_width=2.5, color=BROKER)

    def _build_pipeline(self) -> None:
        self.producer = make_producer()
        self.broker = make_broker()
        self.consumer = make_consumer()
        self.pipe_pb = pipe(tuple(self.producer.body.get_right() + [0.02, 0, 0]), tuple(self.broker.body.get_left() - [0.02, 0, 0]))
        self.pipe_bc = pipe(tuple(self.broker.body.get_right() + [0.02, 0, 0]), tuple(self.consumer.body.get_left() - [0.02, 0, 0]))
        self.pipe_glow = m.VGroup(glow(self.pipe_pb, "#4f6bd8", 0.7), glow(self.pipe_bc, "#4f6bd8", 0.7))
        self.count = m.DecimalNumber(0, num_decimal_places=0, include_sign=True, font_size=16, color=INK)
        self.count.set_opacity(0)
        self.count_val = 0
        self.pipeline = m.VGroup(self.pipe_glow, self.pipe_pb, self.pipe_bc, self.producer, self.broker, self.consumer, self.count)

        def trays(g: m.Mobject) -> None:
            fr = self.f()
            parked = self.parked(fr)
            ready = len(self.ready(fr))
            colors = ([AMBER] if parked else []) + [BROKER] * ready
            for k, tray in enumerate(g.submobjects):
                c = colors[k] if k < len(colors) else None
                key = (c,)
                if getattr(tray, "_k", None) == key:
                    continue
                tray._k = key  # type: ignore[attr-defined]
                if c is None:
                    tray.set_fill(BROKER, opacity=0.06).set_stroke(BROKER, opacity=1.0)
                else:
                    tray.set_fill(c, opacity=0.85).set_stroke(c, opacity=1.0)

        def count(mob: m.Mobject) -> None:
            n = self.in_queue(self.f())
            if n != self.count_val:
                self.count_val = n
                mob.set_value(n)
                mob.set_z_index(4)  # set_value rebuilds the digits at the default z
            k = self.broker.body.width / 1.4
            mob.scale(0.13 * k / mob.height)
            mob.move_to(self.broker.body.get_corner(m.UR) + [-0.26 * k, -0.15 * k, 0])
            fr = self.f()
            opened = self.cue["zoom"] + 9 <= fr < self.cue["pullback"] + 36  # the broker is open on screen
            mob.set_opacity(1 if n > 0 and fr >= self.cue["broker"] + 21 and not opened else 0)

        self.broker.trays.add_updater(trays)  # type: ignore[attr-defined]
        self.count.add_updater(count)

        def spin(g: m.Mobject) -> None:
            t, crash, rec = self.s.time, self.cue["crash"] / self.fps, self.cue["recover"] / self.fps
            a = 1.6 * (min(t, crash) + max(0.0, t - rec - 0.3))
            prev = getattr(g, "_a", 0.0)
            g.rotate(a - prev, about_point=g[1].get_center())
            g._a = a  # type: ignore[attr-defined]

        self.consumer.gear.add_updater(spin)  # type: ignore[attr-defined]

    # ---------- message schedule queries (pure functions of frame) ----------
    def ready(self, fr: float) -> list[dict]:
        return [mm for mm in self.sim["msgs"] if mm["arrive"] <= fr and (not mm["deliveries"] or fr < mm["deliveries"][0])]

    def parked(self, fr: float) -> bool:
        v = self.sim["msgs"][self.sim["victim"]]
        return self.sim["crash"] <= fr < v["deliveries"][1]

    def in_queue(self, fr: float) -> int:
        """Messages the broker holds and has not seen acked: ready, parked, or in flight unacked."""
        n = 0
        for mm in self.sim["msgs"]:
            if mm["arrive"] > fr:
                continue
            if mm["ack_arrive"] is not None and fr >= mm["ack_arrive"]:
                continue
            n += 1
        return n

    def delivery_count(self, fr: float) -> int:
        v = self.sim["msgs"][self.sim["victim"]]
        return sum(1 for d in v["deliveries"] if d <= fr)

    def _build_messages(self) -> None:
        T_PB, T_BC, T_ACK = (self.sim[k] for k in ("T_PB", "T_BC", "T_ACK"))
        crash = self.sim["crash"]
        self.cards = m.VGroup()
        self.acks = m.VGroup()
        for mm in self.sim["msgs"]:
            card = message_card(mm["label"], 1.06, 0.26, 11)
            fader = Fader(card)
            fader.set(0)

            def move(c: m.Mobject, mm=mm, fader=fader) -> None:
                fr = self.f()
                pos, a, col = None, 0.0, INK
                d = mm["deliveries"]
                if mm["spawn"] <= fr < mm["arrive"]:
                    p = smooth01((fr - mm["spawn"]) / T_PB)
                    pos, a = self.pipe_pb.point_from_proportion(p), min(1.0, (fr - mm["spawn"]) / 4)
                for k, dk in enumerate(d):
                    if dk <= fr < dk + T_BC:
                        pos, a = self.pipe_bc.point_from_proportion(smooth01((fr - dk) / T_BC)), 1.0
                        col = AMBER if k == 1 else INK
                    elif fr >= dk + T_BC:
                        top = self.consumer.body.get_top() + [0, 0.32, 0]
                        if mm["victim"] and k == 0 and fr < crash + 12:
                            pos, a, col = top, 1.0 - max(0.0, (fr - crash) / 12), RED if fr >= crash else INK
                        elif mm["victim"] and k == 1 and fr < mm["ack_arrive"] + 14:
                            pos, col = top, GREEN if fr >= mm["ack_start"] else AMBER
                            a = 1.0 - max(0.0, (fr - mm["ack_arrive"] - 6) / 8)
                        elif not mm["victim"] and mm["ack_start"] is not None and fr < mm["ack_start"] + 6:
                            pos, a = top, 1.0 - max(0.0, (fr - mm["ack_start"]) / 6)
                if pos is None:
                    fader.set(0)
                    return
                c.move_to(pos)
                if getattr(c, "_col", None) != col:
                    c[0].set_stroke(col)
                    c[1].set_fill(col)
                    c._col = col  # type: ignore[attr-defined]
                    fader.alpha = -1
                fader.set(a)

            card.add_updater(move)
            self.cards.add(card)
            dot = m.VGroup(m.Dot(radius=0.11, color=GREEN).set_fill(opacity=0.25), m.Dot(radius=0.05, color=GREEN))
            dfader = Fader(dot)
            dfader.set(0)

            def ack(c: m.Mobject, mm=mm, dfader=dfader) -> None:
                fr = self.f()
                if mm["ack_start"] is None or not (mm["ack_start"] <= fr < mm["ack_arrive"]):
                    dfader.set(0)
                    return
                c.move_to(self.pipe_bc.point_from_proportion(1 - smooth01((fr - mm["ack_start"]) / T_ACK)))
                dfader.set(1)

            dot.add_updater(ack)
            self.acks.add(dot)

    def _build_detail(self) -> None:
        """The broker's queue, opened up for the zoom."""
        self.panel = m.RoundedRectangle(corner_radius=0.18, width=5.6, height=1.8, stroke_color=BROKER, stroke_width=4)
        self.panel.set_fill("#0b1736", opacity=0.97).move_to(B_POS)
        self.panel_glow = glow(self.panel, BROKER, 1.1)
        self.panel_title = m.Text("queue: orders", font=MONO, font_size=18, color=MUTED)
        self.detail_alpha = m.ValueTracker(0)
        self.await_alpha = m.ValueTracker(0)
        self.await_label = m.VGroup(m.Dot(radius=0.045, color=AMBER),
                                    m.Text("awaiting ack", font=SANS, weight=m.BOLD, font_size=15, color=AMBER)).arrange(m.RIGHT, buff=0.08)
        self.victim_glow = m.RoundedRectangle(corner_radius=0.1, width=1.18, height=0.6, stroke_color=AMBER, stroke_width=0)
        self.victim_glow = glow(self.victim_glow, AMBER, 1.6)
        self.chrome = m.VGroup(self.panel_glow, self.panel, self.panel_title)
        cfader = Fader(self.chrome)
        cfader.set(0)
        afader = Fader(self.victim_glow)
        afader.set(0)
        self.detail = m.VGroup()
        for mm in self.sim["msgs"]:
            card = message_card(mm["label"], 1.24, 0.6, 13)
            if mm["victim"]:
                card[0].set_stroke(AMBER, width=3).set_fill("#3a2a10", opacity=0.97)
                card[1].set_color("#ffe2b0")
            else:
                card[0].set_stroke(BROKER, width=2).set_fill("#13244f", opacity=0.97)
            fader = Fader(card)
            fader.set(0)

            def slot(c: m.Mobject, mm=mm, fader=fader) -> None:
                a = self.detail_alpha.get_value()
                fr = self.f()
                order = ([self.sim["msgs"][self.sim["victim"]]] if self.parked(fr) else []) + self.ready(fr)
                ids = [o["i"] for o in order]
                if a <= 0.001 or mm["i"] not in ids[:4]:
                    fader.set(0)
                    return
                k = ids.index(mm["i"])
                s = self.panel.width / 5.6
                target_w = 1.24 * s
                if abs(c.width - target_w) > 1e-4:
                    c.scale(target_w / c.width)
                c.move_to([self.panel.get_left()[0] + s * (0.82 + k * 1.33), self.panel.get_center()[1] - 0.1 * s, 0])
                fader.set(a)

            card.add_updater(slot)
            self.detail.add(card)
        self.more = m.Text("+0", font=SANS, weight=m.BOLD, font_size=18, color=INK)
        self.more_val = -1
        mfader = Fader(self.more)

        def chrome(g: m.Mobject) -> None:
            s = self.panel.width / 5.6
            a = self.detail_alpha.get_value()
            # the glow is rebuilt only while the panel changes size or place
            key = (round(self.panel.width, 4), round(float(self.panel.get_center()[0]), 4), round(float(self.panel.get_center()[1]), 4))
            if getattr(g, "_key", None) != key:
                g._key = key  # type: ignore[attr-defined]
                for layer in self.panel_glow:
                    w, op = layer.get_stroke_width(), layer.get_stroke_opacity()
                    layer.become(self.panel.copy().set_fill(opacity=0).set_stroke(BROKER, width=w, opacity=op))
                self.panel_title.scale(0.17 * s / self.panel_title.height)
                self.panel_title.move_to(self.panel.get_corner(m.UL) + [0.25 * s + self.panel_title.width / 2, -0.27 * s, 0])
                self.await_label.scale(0.2 * s / self.await_label.height)
            cfader.alpha = -1
            cfader.set(a)
            fr = self.f()
            n = self.in_queue(fr) - min(4, len(self.ready(fr)) + (1 if self.parked(fr) else 0))
            if n != self.more_val:
                self.more_val = n
                self.more.become(m.Text(f"+{max(n, 0)}", font=SANS, weight=m.BOLD, font_size=18, color=INK))
                mfader.__init__(self.more)
            self.more.scale(0.2 * s / self.more.height)
            self.more.move_to(self.panel.get_corner(m.UR) + [-0.35 * s, -0.27 * s, 0])
            mfader.set(a if n > 0 else 0)
            first = self.panel.get_left() + [s * 0.82, 0, 0]
            first[1] = self.panel.get_center()[1] - 0.1 * s
            self.await_label.move_to(first + [0, -0.48 * s, 0])
            vg_w = 1.18 * s
            for layer in self.victim_glow:
                if abs(layer.width - vg_w * 1.0) > 1e-3:
                    layer.scale(vg_w / layer.width)
                layer.move_to(first)
            pulse = 0.65 + 0.35 * math.sin(self.s.time * 5.0)
            afader.set(self.await_alpha.get_value() * a * (pulse if self.parked(fr) else 0.0))
            self.await_label.set_opacity(self.await_alpha.get_value() * a if self.parked(fr) else 0)

        self.chrome.add_updater(chrome)
        self.s.add(self.detail_alpha, self.await_alpha)

    def _build_code(self) -> None:
        src = (
            "channel.consume('orders', async (msg) => {\n"
            "  const order = JSON.parse(msg.content);\n"
            "  await chargeCard(order);   // the work\n"
            "  channel.ack(msg);          // then ack\n"
            "});"
        )
        self.code = m.Code(code_string=src, language="javascript", background="window",
                           background_config={"fill_color": CODE_BG, "stroke_color": "#2a3558", "stroke_width": 2},
                           paragraph_config={"font": MONO})
        self.code.set(width=5.8).move_to([4.75, -0.1, 0])
        self.code_label = m.Text("consumer.js", font=MONO, font_size=14, color=MUTED)
        self.code_label.scale(0.17 / self.code_label.height).move_to(self.code.get_top() + [0, -0.22, 0])
        self.code_group = m.VGroup(self.code, self.code_label)
        lines = self.code.code_lines
        pitch = float(lines[2].get_center()[1] - lines[3].get_center()[1])
        self.bar = m.RoundedRectangle(corner_radius=0.05, width=self.code.width - 0.3, height=pitch * 0.92,
                                      stroke_width=0).set_fill(AMBER, opacity=0.2)
        self.bar.move_to([self.code.get_center()[0], lines[2].get_center()[1], 0])
        self.bar_ack_y = float(lines[3].get_center()[1])

    def _build_recap(self) -> None:
        self.lost = m.Text("Nothing is lost.", font=SANS, weight=m.BOLD, font_size=76, color=INK,
                           t2c={"lost.": GREEN}).move_to([0, 2.25, 0])

        def chip(text: str, color: str, icon: m.VMobject) -> m.VGroup:
            t = m.Text(text, font=MONO, font_size=22, color=INK)
            icon.scale(0.3 / icon.height)
            row = m.VGroup(icon, t).arrange(m.RIGHT, buff=0.14)
            box = m.RoundedRectangle(corner_radius=0.27, width=row.width + 0.5, height=0.56, stroke_color=color, stroke_width=3)
            box.set_fill(color, opacity=0.1).move_to(row)
            return m.VGroup(glow(box, color, 0.8), box, row)

        tick = m.VGroup(m.Circle(radius=0.15, color=GREEN).set_fill(GREEN, opacity=1),
                        m.VMobject().set_points_as_corners([[-0.07, 0, 0], [-0.02, -0.05, 0], [0.07, 0.05, 0]]).set_stroke("#06291c", width=3))
        loop = m.VGroup(m.Circle(radius=0.15, color=AMBER).set_fill(AMBER, opacity=1),
                        m.Arc(radius=0.08, start_angle=0.4, angle=4.8, stroke_color="#3a2400", stroke_width=3))
        self.chip_a = chip("ack after the work", GREEN, tick)
        self.chip_b = chip("unacked = redelivered", AMBER, loop)
        m.VGroup(self.chip_a, self.chip_b).arrange(m.RIGHT, buff=0.45).move_to([0, 1.2, 0])

    def _build_hud(self, captions: bool) -> None:
        header = m.Text("MESSAGE QUEUES  ·  PART 2", font=SANS, weight=m.BOLD, font_size=15, color=MUTED)
        header.to_corner(m.UL, buff=0.4)
        badge_t = m.Text("AI-generated", font=SANS, font_size=13, color=MUTED)
        badge = m.VGroup(m.RoundedRectangle(corner_radius=0.13, width=badge_t.width + 0.3, height=0.28, stroke_color="#2a3558",
                                            stroke_width=1.5).set_fill("#111a33", opacity=0.9), badge_t)
        badge_t.move_to(badge[0])
        badge.to_corner(m.UR, buff=0.4)
        for mob in (header, badge):
            self.s.add(mob)
            self.pin(mob)
        rows = m.VGroup(
            m.VGroup(m.Text("in_queue", font=MONO, font_size=18, color=INK), m.Text("0", font=MONO, font_size=20, color=BROKER)),
            m.VGroup(m.Text("delivery_count", font=MONO, font_size=18, color=INK), m.Text("0", font=MONO, font_size=20, color=AMBER)),
        )
        for r in rows:
            r[1].next_to(r[0], m.RIGHT, buff=0.6)
        rows.arrange(m.DOWN, aligned_edge=m.LEFT, buff=0.18)
        for r in rows:
            r[1].align_to(rows, m.RIGHT).shift(0.4 * m.RIGHT)
        box = m.RoundedRectangle(corner_radius=0.12, width=rows.width + 0.7, height=rows.height + 0.4, stroke_color="#2a3558",
                                 stroke_width=1.5).set_fill("#0d1326", opacity=0.92).move_to(rows)
        self.counters = m.VGroup(box, rows).to_corner(m.UR, buff=0.4).shift(0.5 * m.DOWN)
        self.counter_vals = [-1, -1]

        def counters(g: m.Mobject) -> None:
            fr = self.f()
            for k, v in enumerate((self.in_queue(fr), self.delivery_count(fr))):
                if v != self.counter_vals[k]:
                    self.counter_vals[k] = v
                    old = g[1][k][1]
                    new = m.Text(str(v), font=MONO, font_size=20, color=BROKER if k == 0 else AMBER)
                    new.scale(old.height / max(new.height, 1e-6)).move_to(old.get_right(), aligned_edge=m.RIGHT)
                    op = old.get_fill_opacity()
                    old.become(new.set_opacity(op))

        self.counters.add_updater(counters)
        self.captions = m.VGroup()
        if captions:
            for c in self.plan["captions"]:
                t = m.Text("\n".join(c["lines"]), font=SANS, weight=m.BOLD, font_size=26, color=INK, line_spacing=0.2)
                bg = m.RoundedRectangle(corner_radius=0.08, width=t.width + 0.36, height=t.height + 0.24, stroke_width=0)
                bg.set_fill("#05070f", opacity=0.72)
                g = m.VGroup(bg, t.move_to(bg))
                g.move_to([0, -3.15 + (0.17 if len(c["lines"]) == 1 else 0), 0])
                fader = Fader(g)
                fader.set(0)

                def show(mm: m.Mobject, c=c, fader=fader) -> None:
                    t = self.s.time * 1000
                    a = smooth01((t - c["start_ms"]) / 120) * (1 - smooth01((t - c["end_ms"] + 120) / 120))
                    fader.set(a)

                g.add_updater(show)
                self.captions.add(g)
            self.s.add(self.captions)
            self.pin(self.captions)
        self.s.add(self.cards, self.acks, self.count)
        self.pipeline.set_z_index(1)
        z = {3: (self.cards,), 4: (self.acks, self.count), 6: (self.chrome, self.code_group, self.bar), 7: (self.detail, self.more),
             8: (self.await_label, self.victim_glow), 10: (header, badge, self.counters, self.captions)}
        for level, mobs in z.items():
            for mob in mobs:
                mob.set_z_index(level)
        self.title.set_z_index(9)
        self.underline.set_z_index(9)

    def _build_crash_fx(self) -> None:
        rng = random.Random(42)
        self.shards = m.VGroup()
        params = []
        for _ in range(46):
            a = rng.random() * math.tau
            v = 6 + rng.random() * 16
            spin = (rng.random() - 0.5) * 24
            size = (6 + rng.random() * 18) / 135
            k = rng.random()
            tri = m.Polygon([0, size, 0], [size * (0.5 + k * 0.5), -size * 0.6, 0], [-size * 0.7, -size * (0.2 + k * 0.4), 0],
                            stroke_width=0).set_fill(RED if k > 0.45 else "#ffd0d5", opacity=0)
            params.append((a, v, spin))
            self.shards.add(tri)

        def burst(g: m.Mobject) -> None:
            t = self.f() - self.sim["crash"]
            if t < 0 or t > 60:
                if getattr(g, "_on", False):
                    g.set_fill(opacity=0)
                    g._on = False  # type: ignore[attr-defined]
                return
            g._on = True  # type: ignore[attr-defined]
            c = self.consumer.body.get_center()
            drag = 1 - math.exp(-t / 14)
            op = 1 - 0.3 * min(1, t / 40) - 0.7 * max(0, (t - 40) / 20)
            for tri, (a, v, spin) in zip(g.submobjects, params, strict=True):
                ang = math.radians(spin * t)
                prev = getattr(tri, "_r", 0.0)
                tri.rotate(ang - prev)
                tri._r = ang  # type: ignore[attr-defined]
                tri.move_to([c[0] + math.cos(a) * v * 14 * drag / 135, c[1] - (math.sin(a) * v * 14 * drag + 0.06 * t * t) / 135, 0])
                tri.set_fill(opacity=op)

        self.shards.add_updater(burst)
        self.s.add(self.shards.set_z_index(5))
        cx, cy = C_POS[0], C_POS[1] - 0.2
        self.xmark = m.VGroup(m.Line([cx - 0.2, cy - 0.2, 0], [cx + 0.2, cy + 0.2, 0]), m.Line([cx - 0.2, cy + 0.2, 0], [cx + 0.2, cy - 0.2, 0]))
        self.xmark.set_stroke(RED, width=7).set_z_index(5)
        t0 = self.sim["crash"] / self.fps

        def offset(t: float) -> tuple[float, float, float]:
            """Camera offset at time t: a slow ambient drift (1% breathe) plus the decaying crash shake."""
            x, y, k = 0.05 * math.sin(t / 2.7), 0.03 * math.cos(t / 2.2), 1 + 0.012 * math.sin(t / 1.8)
            u = t - t0
            if 0 <= u < 0.6:
                amp = 0.1 * (1 - u / 0.6)
                x, y = x + amp * math.sin(u * 71), y + amp * math.cos(u * 53) * 0.8
            return x, y, k

        last = [offset(0.0)]

        @flow
        def camera(dt: float) -> None:
            # Applied as a change since the previous frame, so it rides on top of the camera moves
            # the recipes animate instead of fighting them.
            (x0, y0, k0), (x1, y1, k1) = last[0], offset(self.s.time)
            self.frame.scale(k1 / k0).shift([x1 - x0, y1 - y0, 0])
            last[0] = (x1, y1, k1)

        self.s.add_updater(camera)

    # ---------- recipes (closed vocabulary) ----------
    def r_writeTitle(self, cue: str) -> list:
        return [m.Write(self.title)]

    def r_indicate(self, cue: str) -> list:
        self.red_line = m.Line(self.crash_word.get_corner(m.DL), self.crash_word.get_corner(m.DR), stroke_width=5, color=RED)
        self.red_line.shift(0.12 * m.DOWN)
        return [m.Indicate(self.crash_word, color=RED, scale_factor=1.08), m.Create(self.red_line)]

    def r_dockTitle(self, cue: str) -> list:
        target = self.title.copy().scale(0.36).move_to([0, 3.35, 0])
        self.underline.next_to(target, m.DOWN, buff=0.12)
        return [self.title.animate.scale(0.36).move_to([0, 3.35, 0]), m.FadeOut(self.red_line), m.Create(self.underline)]

    def r_buildPipeline(self, cue: str) -> list:
        if cue in ("producer", "broker", "consumer"):
            node: Node = getattr(self, cue)
            return [m.FadeIn(node.halo), m.FadeIn(node.glow), m.Create(node.body), m.LaggedStart(*(m.FadeIn(d, shift=0.1 * m.UP) for d in node.details), lag_ratio=0.15),
                    m.Write(node.tag)]
        p = self.pipe_pb if cue == "pipe_pb" else self.pipe_bc
        g = self.pipe_glow[0 if cue == "pipe_pb" else 1]
        return [m.Create(p), m.FadeIn(g)]

    def r_streamMessages(self, cue: str) -> list:
        if cue == "stream":
            return [m.Indicate(self.producer.body, color=PRODUCER, scale_factor=1.04)]
        if cue == "fill":
            return [m.Indicate(self.broker.trays, color=BROKER, scale_factor=1.06)]  # type: ignore[attr-defined]
        return [m.Circumscribe(self.consumer.body, color=GREEN, buff=0.08, stroke_width=3)]

    def r_crash(self, cue: str) -> list:
        c = self.consumer
        return [c.body.animate.set_stroke(RED), c.glow.animate.set_stroke(RED), c.halo.animate.set_fill(RED),
                c.details.animate.set_stroke(RED), c.tag.animate.set_color(RED),
                m.Create(self.xmark), m.Flash(c.body.get_center(), color=RED, line_length=0.35, num_lines=14, flash_radius=1.0)]

    def r_zoomAndOpen(self, cue: str) -> list:
        if cue == "zoom":
            self.pin(self.title)
            self.pin(self.underline)
            self.s.add(self.chrome, self.detail, self.more, self.await_label, self.victim_glow)
            return [self.frame.animate.set(width=BASE_W / 2.15).move_to([B_POS[0], B_POS[1] + 0.07, 0]),
                    m.Succession(m.Wait(run_time=0.3), m.FadeOut(self.broker, run_time=0.5)),
                    m.Succession(m.Wait(run_time=0.35), self.detail_alpha.animate.set_value(1))]
        if cue == "counters":
            self.s.add(self.counters)
            self.pin(self.counters)
            return [m.FadeIn(self.counters)]
        return [self.await_alpha.animate.set_value(1)]

    def r_codeHighlight(self, cue: str) -> list:
        if cue == "split":
            return [self.frame.animate.set(width=BASE_W / 1.35).move_to([2.47, -0.08, 0]),
                    self.panel.animate.scale(0.72).move_to([-0.55, -0.15, 0]),
                    m.FadeIn(self.code_group, shift=0.4 * m.LEFT)]
        if cue == "work_line":
            return [m.FadeIn(self.bar), self.code.code_lines[2].animate.set_color(AMBER)]
        return [self.bar.animate.set_y(self.bar_ack_y).set_fill(GREEN, opacity=0.25),
                self.code.code_lines[3].animate.set_color(GREEN)]

    def r_redeliver(self, cue: str) -> list:
        b, c = self.broker, self.consumer
        if cue == "pullback":
            return [self.frame.animate.set(width=BASE_W).move_to(m.ORIGIN), m.FadeIn(self.broker),
                    self.detail_alpha.animate.set_value(0),
                    self.panel.animate.scale(0.25).move_to(B_POS),
                    m.VGroup(self.code_group, self.bar).animate.scale(0.5).move_to([-4.85, 2.3, 0])]
        if cue == "recover":
            return [c.body.animate.set_stroke(GREEN), c.glow.animate.set_stroke(GREEN), c.halo.animate.set_fill(GREEN),
                    c.details.animate.set_stroke(GREEN), c.tag.animate.set_color(INK), m.FadeOut(self.xmark),
                    m.Flash(c.body.get_center(), color=GREEN, line_length=0.3, num_lines=12, flash_radius=0.95)]
        if cue == "redeliver":
            return [m.Indicate(b.trays[0], color=AMBER, scale_factor=1.15)]  # type: ignore[attr-defined]
        return [b.body.animate.set_stroke("#2dd4bf"), b.glow.animate.set_stroke("#2dd4bf"),
                m.Flash(b.body.get_right(), color=GREEN, line_length=0.3, num_lines=12, flash_radius=0.5)]

    def r_recap(self, cue: str) -> list:
        if cue == "title_lost":
            self.unpin(self.title)
            self.unpin(self.underline)
            self.unpin(self.counters)
            fade_pipe = [self.pipeline.animate.shift(0.55 * m.DOWN).scale(0.86)]
            return [m.TransformMatchingShapes(self.title, self.lost), m.FadeOut(self.underline), m.FadeOut(self.counters),
                    m.FadeOut(self.code_group), m.FadeOut(self.bar), *fade_pipe]
        chip = self.chip_a if cue == "chip_ack" else self.chip_b
        return [m.FadeIn(chip[0]), m.Create(chip[1]), m.FadeIn(chip[2], shift=0.15 * m.UP)]
