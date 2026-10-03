"""Multi Reroute: a stack of N reroute rows in one node.

Each row i is an independent pass-through channel: input "route i" → output
"route i". The backend declares MAX_ROUTES optional wildcard inputs and
MAX_ROUTES wildcard outputs; row i's output returns row i's input value
(None when unconnected).

The number of VISIBLE rows is chosen on the frontend (combo widget,
1..MAX_ROUTES, see web/multi_reroute.js). Rows are only ever added/removed
at the END of both slot lists, so connected links keep their indices.

Must be a V3 node registered through comfy_entrypoint: this ComfyUI's
custom-node loader takes `if NODE_CLASS_MAPPINGS ... return True` and skips
comfy_entrypoint entirely, so a V1 mapping in this pack would unregister all
V3 nodes (PromptTagEditor / LoadImageFromPath).
"""

from comfy_api.latest import io

MAX_ROUTES = 20

# Wildcard io type: the frontend treats "*" sockets as accept-anything, and
# server-side link validation accepts "*" on both ends (same type the
# built-in Reroute uses).
AnyIO = io.Custom("*")


class MultiReroute(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MultiReroute",
            display_name="Multi Reroute",
            category="Prompt Tools",
            description="A stack of independent reroute rows. Set the row count "
                        "with the routes widget; each row passes its input through "
                        "to the matching output.",
            inputs=[AnyIO.Input(f"route {i}", optional=True)
                    for i in range(1, MAX_ROUTES + 1)],
            outputs=[AnyIO.Output(f"route {i}")
                     for i in range(1, MAX_ROUTES + 1)],
        )

    @classmethod
    def execute(cls, **kwargs):
        # Row i's output = row i's input (None when that row is unconnected).
        return io.NodeOutput(*[kwargs.get(f"route {i}")
                               for i in range(1, MAX_ROUTES + 1)])
