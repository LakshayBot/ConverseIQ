import { render, screen } from '@testing-library/react';
import ProductDetailsCard from '@/components/ProductDetailsCard';

jest.mock('@/lib/api', () => ({
  apiGetProductDetails: jest.fn().mockResolvedValue({
    name: 'Meter X100',
    type: 'product',
    description: 'Flagship smart meter.',
    documents: [],
    isSeed: false,
    notFound: false,
  }),
}));

const TURN =
  'I like the hardware, but the accuracy drifts after six months of operation and that worries our compliance team.';

function renderCard(props: Partial<Parameters<typeof ProductDetailsCard>[0]> = {}) {
  return render(
    <ProductDetailsCard
      productName="Meter X100"
      category="product"
      supportingTranscript={TURN}
      onDismiss={() => {}}
      {...props}
    />,
  );
}

describe('ProductDetailsCard — contextual trigger highlight', () => {
  it('renders a <mark> around the trigger span for contextual matches', async () => {
    renderCard({ triggerType: 'contextual', triggerSpan: 'accuracy drifts after six months' });

    // Section heading present.
    expect(screen.getByText('Why this card appeared')).toBeInTheDocument();

    // Full buyer turn is rendered as text around the highlight.
    const mark = screen.getByTestId('trigger-span-highlight');
    expect(mark.tagName).toBe('MARK');
    expect(mark.textContent).toBe('accuracy drifts after six months');
    // The wrapper paragraph contains the full turn: before + <mark> + after.
    expect(mark.parentElement?.textContent).toBe(TURN);
  });

  it('renders no <mark> for keyword triggers', async () => {
    renderCard({ triggerType: 'keyword' });

    expect(screen.queryByTestId('trigger-span-highlight')).not.toBeInTheDocument();
    expect(screen.queryByText('Why this card appeared')).not.toBeInTheDocument();
    // Existing transcript-context block is unchanged.
    expect(screen.getByText('Transcript context')).toBeInTheDocument();
  });

  it('renders no <mark> when triggerType is absent (back-compat)', () => {
    renderCard();

    expect(screen.queryByTestId('trigger-span-highlight')).not.toBeInTheDocument();
    expect(screen.getByText('Transcript context')).toBeInTheDocument();
  });
});
