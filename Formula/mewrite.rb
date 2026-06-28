class Mewrite < Formula
  desc "Me Write Code terminal coding agent"
  homepage "https://github.com/Zhachory1/mewritecode"
  version "0.66.4"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/Zhachory1/mewritecode/releases/download/v#{version}/mewrite-darwin-arm64.tar.gz"
      sha256 "aefbccadf101eceb983a07ea2e1019d0571bc112f5b48b6075ffb0d2fd561823"
    end
    on_intel do
      url "https://github.com/Zhachory1/mewritecode/releases/download/v#{version}/mewrite-darwin-x64.tar.gz"
      sha256 "12bec8eaca5730c0533c47f94a4bdea4ed2e3ac504807f3f4e2c9bbc17a1e687"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/Zhachory1/mewritecode/releases/download/v#{version}/mewrite-linux-arm64.tar.gz"
      sha256 "443df04f69c0da880a5c635d98e5dbf883b29a536a5ea376d7f4b46a1390eee9"
    end
    on_intel do
      url "https://github.com/Zhachory1/mewritecode/releases/download/v#{version}/mewrite-linux-x64.tar.gz"
      sha256 "2d18ec01a4988f07ef764c67dc638303e1542cdb6132c29d67a0b424376f2e92"
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
