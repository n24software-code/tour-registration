import Image from 'next/image';
import wpcEnergy from '@/public/logos/logo1.png';
import congress from '@/public/logos/logo2.png';
import ministry from '@/public/logos/logo3.png';

/**
 * The three partner logos, always in this order left to right. The row is forced to
 * `dir="ltr"` so an Arabic (RTL) page keeps the agreed order instead of mirroring it.
 *
 * The imports are static, so next/image bakes in each file's real width and height and
 * the browser reserves the right box before the bytes arrive — no layout shift. Each
 * image is sized by height with `w-auto`, which keeps every logo the same visible height
 * without ever cropping or distorting it.
 */
const LOGOS = [
  { src: wpcEnergy, alt: "WPC Energy" },
  { src: congress, alt: "25th WPC Energy Congress, 11–15 October 2026" },
  { src: ministry, alt: "Ministry of Energy" },
] as const;

/** 32px on a phone, 56px from `sm` up. Admin uses 28px throughout. */
const SIZE = {
  large: { img: 'h-8 w-auto sm:h-14', gap: 'gap-3 sm:gap-6', pad: 'pl-3 sm:pl-6', sizes: '(max-width: 640px) 90px, 160px' },
  small: { img: 'h-7 w-auto', gap: 'gap-3', pad: 'pl-3', sizes: '80px' },
} as const;

export function Logos({ size = 'large', className = '' }: { size?: 'large' | 'small'; className?: string }) {
  const s = SIZE[size];
  return (
    <div dir="ltr" className={`flex items-center ${s.gap} ${className}`}>
      {LOGOS.map((logo, i) => (
        <div key={logo.alt} className={i > 0 ? `border-l border-ink/10 ${s.pad}` : undefined}>
          <Image
            src={logo.src}
            alt={logo.alt}
            priority={size === 'large'}
            sizes={s.sizes}
            className={`${s.img} object-contain`}
          />
        </div>
      ))}
    </div>
  );
}

/** Full-width white band for the public pages, sitting at the very top. */
export function LogoBand() {
  return (
    <div className="w-full border-b border-ink/10 bg-white">
      <div className="mx-auto flex max-w-7xl justify-center px-4 py-3 sm:px-5 sm:py-4">
        <Logos size="large" />
      </div>
    </div>
  );
}
