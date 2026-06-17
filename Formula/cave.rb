class Cave < Formula
  desc "Minimal terminal coding agent + multi-provider LLM toolkit"
  homepage "https://github.com/JuliusBrussee/caveman-cli"
  version "0.65.2"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/JuliusBrussee/caveman-cli/releases/download/v#{version}/cave-darwin-arm64.tar.gz"
      sha256 "PLACEHOLDER_DARWIN_ARM64"
    end
    on_intel do
      url "https://github.com/JuliusBrussee/caveman-cli/releases/download/v#{version}/cave-darwin-x64.tar.gz"
      sha256 "PLACEHOLDER_DARWIN_X64"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/JuliusBrussee/caveman-cli/releases/download/v#{version}/cave-linux-arm64.tar.gz"
      sha256 "PLACEHOLDER_LINUX_ARM64"
    end
    on_intel do
      url "https://github.com/JuliusBrussee/caveman-cli/releases/download/v#{version}/cave-linux-x64.tar.gz"
      sha256 "PLACEHOLDER_LINUX_X64"
    end
  end

  def install
    # cave resolves theme/, export-html/, photon_rs_bg.wasm, etc. relative to
    # dirname(process.execPath), so the binary and companions must live together.
    libexec.install Dir["*"]
    bin.write_exec_script libexec/"cave"
    bin.install_symlink bin/"cave" => "caveman"
    bin.install_symlink bin/"cave" => "mewrite"
    bin.install_symlink bin/"cave" => "mewritecode"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/cave --version")
  end
end
