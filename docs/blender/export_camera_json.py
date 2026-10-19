# Harry AI FILM STUDIO — export the active scene camera's path as camera.json (Blender 4.x/5.x).
# Run inside Blender (Text Editor → Run Script, or through the Blender MCP). Read-only for the
# scene: it only reads the camera and writes camera.json next to the render output folder.
#
# Output: { "fps": 24, "frames": [ { "frame": 1, "location": [x, y, z],
#            "rotation_euler": [rx, ry, rz], "lens_mm": 35.0 }, ... ] }
# Import the render folder in the studio (Asset Library → Import Blender previz); the studio
# reads camera.json from the same folder and derives the camera moves and focal length.
import bpy, json, os

scene = bpy.context.scene
cam = scene.camera
if cam is None:
    raise RuntimeError("No active scene camera")

out_dir = bpy.path.abspath(os.path.dirname(scene.render.filepath) or "//")
os.makedirs(out_dir, exist_ok=True)
fps = scene.render.fps / scene.render.fps_base
frames = []
current = scene.frame_current
try:
    for f in range(scene.frame_start, scene.frame_end + 1):
        scene.frame_set(f)
        mw = cam.matrix_world
        loc = mw.to_translation()
        rot = mw.to_euler('XYZ')  # world-space rotation, so parented/constrained cameras work too
        frames.append({"frame": f, "location": [loc.x, loc.y, loc.z], "rotation_euler": [rot.x, rot.y, rot.z],
                       "lens_mm": cam.data.lens if cam.data.type == 'PERSP' else None})
finally:
    scene.frame_set(current)  # leave the scene where it was

path = os.path.join(out_dir, "camera.json")
with open(path, "w") as fh:
    json.dump({"fps": fps, "camera": cam.name, "frames": frames}, fh, indent=1)
print(f"camera.json written: {path} ({len(frames)} frames)")
