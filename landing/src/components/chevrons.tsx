import type { SVGProps } from 'react'

function base({ size = 14, ...rest }: SVGProps<SVGSVGElement> & { size?: number }): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    ...rest,
  }
}

export function IconChevronDown(props: SVGProps<SVGSVGElement> & { size?: number }): React.JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M6 9.5 12 15.5 18 9.5" />
    </svg>
  )
}

export function IconChevronRight(props: SVGProps<SVGSVGElement> & { size?: number }): React.JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M9.5 6 15.5 12 9.5 18" />
    </svg>
  )
}
