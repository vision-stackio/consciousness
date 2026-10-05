/**
 * Obstacle avoidance for Vision's walking. Pure math, no DOM, so it can be tested headlessly.
 *
 * Headings use the project's convention: forward = (sin h, cos h), degrees, and turning
 * right increases h. Steering works on the *desired* heading (toward the goal or the
 * wander direction): if an obstacle sits in the corridor ahead, the heading is deflected
 * to the clearer side; once the robot has sidestepped enough, the deflection fades and
 * it carries on toward its goal.
 */
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
export class Steering {
    avoiding = new Set(); // hysteresis: keep avoiding until clearly past
    pref = 0; // side we chose, kept while the path is blocked
    /** First obstacle that blocks travel along `headingDeg`, or null if the corridor is clear. */
    blocker(pos, headingDeg, obstacles, o, ignoreNear) {
        const h = rad(headingDeg), fx = Math.sin(h), fz = Math.cos(h);
        let hit = null;
        for (const ob of obstacles) {
            if (ob.id === o.ignore)
                continue;
            if (ignoreNear && Math.hypot(ob.x - ignoreNear.x, ob.z - ignoreNear.z) < 1e-6)
                continue;
            const dx = ob.x - pos.x, dz = ob.z - pos.z;
            const along = dx * fx + dz * fz;
            const lateral = dx * fz - dz * fx; // + = obstacle is to our right
            const clear = (ob.r + o.body + o.margin) * (this.avoiding.has(ob.id) ? 1.25 : 1);
            if (along > -ob.r && along < o.lookahead + ob.r && Math.abs(lateral) < clear && (!hit || along < hit.along))
                hit = { id: ob.id, along, lateral };
        }
        return hit;
    }
    /**
     * Returns the heading to actually steer toward, given the one we would like.
     * Tries the desired heading, then the smallest sidestep (either side) whose corridor is free.
     */
    heading(pos, desiredDeg, obstacles, o, ignoreNear) {
        const first = this.blocker(pos, desiredDeg, obstacles, o, ignoreNear);
        if (!first) {
            this.avoiding.clear();
            this.pref = 0;
            return desiredDeg;
        }
        // remember who is in the way so they stay "blocking" until we are clearly past them
        const now = new Set([first.id]);
        for (const ob of obstacles) {
            const b = this.blocker(pos, desiredDeg, obstacles.filter((x) => x.id === ob.id), o, ignoreNear);
            if (b)
                now.add(ob.id);
        }
        const pref = (this.pref || (first.lateral >= 0 ? -1 : 1));
        for (const step of [15, 25, 35, 45, 55, 65, 75, 85]) {
            for (const sgn of [pref, (-pref)]) {
                if (!this.blocker(pos, desiredDeg + sgn * step, obstacles, o, ignoreNear)) {
                    this.pref = sgn;
                    this.avoiding = now;
                    return desiredDeg + sgn * step;
                }
            }
        }
        this.pref = pref;
        this.avoiding = now;
        return desiredDeg + pref * 85; // boxed in: turn hard away, overlap push-out is the last line of defense
    }
    forget() { this.avoiding.clear(); this.pref = 0; }
}
/** If the robot has ended up inside an obstacle (brushed it, was teleported...), push it back out. */
export function resolveOverlap(pos, obstacles, body, ignore) {
    let x = pos.x, z = pos.z, moved = false;
    for (const ob of obstacles) {
        if (ob.id === ignore)
            continue;
        const dx = x - ob.x, dz = z - ob.z;
        const d = Math.hypot(dx, dz), min = ob.r + body;
        if (d < min) {
            const nx = d > 1e-6 ? dx / d : 1, nz = d > 1e-6 ? dz / d : 0;
            x = ob.x + nx * min;
            z = ob.z + nz * min;
            moved = true;
        }
    }
    return moved ? { x, z } : null;
}
