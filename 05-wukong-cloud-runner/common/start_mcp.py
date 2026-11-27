"""在我自己启动的 Blender 实例里打开 MCP 服务（只用来搜索 / 下载 / 生成素材）。"""
import bpy


def _go():
    try:
        import blender_mcp
        s = bpy.context.scene
        s.blendermcp_auto_start_server = True
        r = blender_mcp._blendermcp_ensure_server_running()
        print('WK_MCP start ->', r, 'running =', s.blendermcp_server_running, flush=True)
        if not s.blendermcp_server_running:
            return 1.0
    except Exception as e:
        print('WK_MCP error:', repr(e), flush=True)
        return 2.0
    return None


bpy.app.timers.register(_go, first_interval=2.0)
