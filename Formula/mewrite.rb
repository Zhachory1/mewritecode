class Mewrite < Formula
  desc "Me Write Code terminal coding agent"
  homepage "https://github.com/Zhachory1/mewritecode"
  version "0.66.3"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/Zhachory1/mewritecode/releases/download/v#{version}/mewrite-darwin-arm64.tar.gz"
      sha256 "13bf3531f48fe078ef74086ad7888205f5dc06721e361f99e608556e49816db4"
    end
    on_intel do
      url "https://github.com/Zhachory1/mewritecode/releases/download/v#{version}/mewrite-darwin-x64.tar.gz"
      sha256 "cea6427c31e9aa664f00701a4e466c67bc1f8ae75cec7855d32e91052df0b992"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/Zhachory1/mewritecode/releases/download/v#{version}/mewrite-linux-arm64.tar.gz"
      sha256 "a2fa4240fdb0896ad23f9d22899652be912641c81719b2a9ef8769929ea5affc"
    end
    on_intel do
      url "https://github.com/Zhachory1/mewritecode/releases/download/v#{version}/mewrite-linux-x64.tar.gz"
      sha256 "3be651fb3f635cd09c83f2c23b643283f638fbc55ae4b4d9808a8eae52c8467d"
    end
  end

  def install
    # mewrite resolves theme/, export-html/, photon_rs_bg.wasm, etc. relative to
    # dirname(process.execPath), so the binary and companions must live together.
    libexec.install Dir["*"]
    bin.write_exec_script libexec/"mewrite"
    bin.install_symlink bin/"mewrite" => "mewrite-code"
    bin.install_symlink bin/"mewrite" => "mewritecode"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/mewrite --version")
  end
end
