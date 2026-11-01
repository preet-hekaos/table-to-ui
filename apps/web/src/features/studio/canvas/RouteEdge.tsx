import { BaseEdge, type Edge, type EdgeProps } from '@xyflow/react'

export type RouteEdgeData = { d: string; labelX: number; labelY: number }

/** A link drawn along the route chosen for it: square corners, its own lane, hops where it crosses another line. */
export function RouteEdge({ id, data, label, markerEnd, style, labelStyle, labelBgPadding, interactionWidth }: EdgeProps<Edge<RouteEdgeData>>) {
  if (!data) return null
  return (
    <BaseEdge
      id={id}
      path={data.d}
      labelX={data.labelX}
      labelY={data.labelY}
      label={label}
      labelStyle={labelStyle}
      labelBgPadding={labelBgPadding}
      markerEnd={markerEnd}
      style={style}
      interactionWidth={interactionWidth ?? 20}
    />
  )
}
