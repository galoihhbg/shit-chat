Pod::Spec.new do |s|
  s.name           = 'ToiletVision'
  s.version        = '0.1.0'
  s.summary        = 'On-device hand landmarks and toilet detection via MediaPipe'
  s.description    = 'Local MediaPipe Tasks Vision wrapper for ShitChat proof verification.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'MediaPipeTasksVision', '~> 1.0.0'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
