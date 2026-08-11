// ============================================================================
// Icons — hand-drawn 24×24 stroke icons, consistent with the product's
// restrained technical vocabulary. No icon library.
// ============================================================================

import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function base({ size = 18, ...rest }: IconProps): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    ...rest,
  }
}

export function IconProduct(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z" />
      <path d="M4 7.5 12 12l8-4.5M12 12v9" />
    </svg>
  )
}

export function IconPricing(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v9M14.5 9.5c-.6-1-1.5-1.5-2.5-1.5-1.2 0-2 .7-2 1.6 0 2.2 4.5 1.3 4.5 3.6 0 .9-.9 1.8-2.5 1.8-1.1 0-2-.6-2.5-1.5" />
    </svg>
  )
}

export function IconObjection(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M12 3.5 3.5 7v5.2c0 4.6 3.4 7.4 8.5 8.8 5.1-1.4 8.5-4.2 8.5-8.8V7z" />
      <path d="M12 8.5v4" />
      <circle cx="12" cy="15.5" r="0.5" fill="currentColor" />
    </svg>
  )
}

export function IconTechnical(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M9.5 15.5 4 10l5.5-5.5M14.5 8.5 20 14l-5.5 5.5" />
      <path d="M13.5 4.5 10.5 19.5" />
    </svg>
  )
}

export function IconCompetitor(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2" />
    </svg>
  )
}

export function IconPricingQuestion(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.5 9.2c.4-1 1.3-1.6 2.5-1.6 1.3 0 2.3.8 2.3 2 0 1.3-1 1.8-2 2.4-.6.4-.8.8-.8 1.5" />
      <circle cx="12" cy="16.8" r="0.6" fill="currentColor" />
    </svg>
  )
}

export function IconRecommendation(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M12 3.5c2 3 4.5 4.2 7 4.2v6.3c0 3.6-2.8 5.6-7 6.8-4.2-1.2-7-3.2-7-6.8V7.7c2.5 0 5-1.2 7-4.2z" />
      <path d="M9 12.2l2.2 2.2 3.8-4.2" />
    </svg>
  )
}

export function IconSource(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M5 4.5h9L18.5 9v10.5H5z" />
      <path d="M13.5 4.5V9H18.5M8 13h8M8 16.5h5.5" />
    </svg>
  )
}

export function IconArrow(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M4 12h15M13 6l6 6-6 6" />
    </svg>
  )
}

export function IconArrowUpRight(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M6 18 18 6M9 6h9v9" />
    </svg>
  )
}

export function IconGitHub(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M12 2.8a9.2 9.2 0 0 0-2.9 17.9c.5.1.6-.2.6-.5v-1.7c-2.6.6-3.1-1.3-3.1-1.3-.4-1.1-1-1.4-1-1.4-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .8 1.5 2.2 1.1 2.7.8.1-.6.3-1.1.6-1.3-2.1-.2-4.3-1-4.3-4.6 0-1 .4-1.9 1-2.5-.1-.3-.4-1.3.1-2.6 0 0 .8-.3 2.7 1a9.4 9.4 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.3.2 2.3.1 2.6.6.7 1 1.5 1 2.5 0 3.6-2.2 4.4-4.3 4.6.3.3.6.8.6 1.6v2.3c0 .3.1.6.6.5A9.2 9.2 0 0 0 12 2.8z" />
    </svg>
  )
}

export function IconCheck(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
    </svg>
  )
}

export function IconMic(props: IconProps): React.JSX.Element {
  return (
    <svg {...base(props)}>
      <rect x="8.5" y="3" width="7" height="11" rx="3.5" />
      <path d="M5 11.5a7 7 0 0 0 14 0M12 18.5V21" />
    </svg>
  )
}
