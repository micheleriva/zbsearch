import { HomeLayout } from 'fumadocs-ui/layouts/home'
import { HomeHeader } from '@/components/layout/home-header'
import { baseOptions } from '@/lib/layout.shared'

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <HomeLayout {...baseOptions()} slots={{ header: HomeHeader }}>
      {children}
    </HomeLayout>
  )
}
