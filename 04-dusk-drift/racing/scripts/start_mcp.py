# 在独立的 Blender 实例里启动 MCP for Blender 服务器（不影响用户已打开的 Blender）
import bpy
import addon_utils


def _start():
    try:
        loaded = addon_utils.check("blender_mcp")
        if not loaded[1]:
            addon_utils.enable("blender_mcp", default_set=False)
        sc = bpy.context.scene
        for prop in ("blendermcp_use_polyhaven", "blendermcp_use_sketchfab"):
            if hasattr(sc, prop):
                try:
                    setattr(sc, prop, True)
                except Exception as e:
                    print("prop fail", prop, e)
        win = bpy.context.window_manager.windows[0]
        with bpy.context.temp_override(window=win):
            res = bpy.ops.blendermcp.start_server()
        print("MCP_START_RESULT", res, "running=", sc.blendermcp_server_running, "port=", sc.blendermcp_port)
    except Exception as e:
        import traceback
        traceback.print_exc()
        print("MCP_START_FAILED", e)
    return None


bpy.app.timers.register(_start, first_interval=3.0)
